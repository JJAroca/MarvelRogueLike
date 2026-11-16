// HUD arcade sci-fi (marcos metálicos azul oscuro con biseles iluminados en rojo/cian).
//   · Arriba izquierda: retrato pixel art + vida/escudo + nombre/tag + celdas de recurso (armadura 0/3...)
//   · Arriba derecha: Gemas del Infinito, botón de silencio y minimapa táctico del piso.
//   · Abajo centro: hotbar de habilidades (Espacio/Shift/Q) + inventario de 6 ranuras con tooltip.
//   · Barra del jefe arriba al centro, avisos de ítem, cartel de sala y transición con portal.
// Todo se dibuja en el canvas; hitTest() permite al input hacer clic en ranuras y botones.
import { heroSpriteKey } from './sprites.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const RARITY = { common: '#cfd6e0', rare: '#4fa8ff', epic: '#c06bff', legendary: '#ffb52e' };
const RARITY_NAME = { common: 'Común', rare: 'Raro', epic: 'Épico', legendary: 'Legendario' };
const SLOT_FOR = { common: 'slot', rare: 'slot', epic: 'slot_epic', legendary: 'slot_rare' };
const DOOR_COLOR = { next: '#7fffb0', back: '#9fb4e0', treasure: '#ffd76a', vault: '#5aa0ff', challenge: '#ff5aa0', secret: '#c070ff', floor: '#ff9a3a', victory: '#ffd76a' };
const ST = { confuse: 16 };
const GEM_COLORS = ['#a052ff', '#3d7bff', '#ff3b3b', '#ff9a1f', '#2ee86b', '#ffd21f'];
const MOD_LABEL = {
  hp: 'Vida máxima', dmg: 'Daño', speed: 'Velocidad', armor: 'Reducción de daño', crit: 'Crítico', lifesteal: 'Robo de vida',
  regen: 'Regeneración/s', atkSpeed: 'Velocidad de ataque', cd: 'Enfriamientos', dashCd: 'Enfriamiento del dash',
  shield: 'Escudo (de la vida)', melee: 'Daño cuerpo a cuerpo', ability: 'Daño de habilidad', luck: 'Prob. ítems raros',
};
// Icono (PNG de output_effects) de la habilidad y la ulti de cada héroe.
const ABILITY_ICONS = {
  ironman: ['IronManBlast', 'IronManUniBeam'], hulkbuster: ['HulkSmashCrack', 'IronManUniBeam'],
  ghostrider: ['GhostRiderAtack', 'OrangeFire'], ghostrider_blue: ['GhostRiderAtack', 'BlueFire'],
  hulk: ['HulkSmashCrack', 'ExplosionBoom'], banner: ['TargetCrosshair', 'TargetCrosshair'],
  strange: ['SonicPulse', 'StrangeUlti'], spider2099: ['CrimsonSlash', 'SonicPulse'],
  cap: ['SonicPulse', 'StrangeUlti'], thor: ['IronManBlast', 'ExplosionBoom'], venom: ['CrimsonSlash', 'VoidPortal'],
  wolverine: ['CrimsonSlash', 'CrimsonSlash'], scarlet: ['MagnetoAtack', 'VoidPortal'], loki: ['VoidPortal', 'SonicPulse'],
};

export class UIRenderer {
  constructor(renderer, S) {
    this.r = renderer;
    this.S = S;
    this.ctx = renderer.ctx;
    this.hits = [];          // [{x, y, w, h, type, i}] zonas clicables de este frame
    this.banner = null;      // cartel de sala
    this.lastRoom = '';
    this.trA = 0;            // progreso de la transición (iris)
    // ── Rendimiento: nada de gradientes, filtros ni lienzos nuevos dentro del bucle ──
    this.panelCache = new Map();   // panel metálico ya dibujado (bitmap) por tamaño/colores
    this.gradCache = new Map();    // gradientes en coordenadas locales (se dibujan con translate)
    this.gemCache = {};            // silueta apagada de cada gema (antes: ctx.filter en cada frame)
    this.time = 0;
  }

  hitTest(x, y) {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    }
    return null;
  }

  // ───────── Primitivas de estilo ─────────
  // Panel metálico con esquinas biseladas y luces de acento roja/cian.
  // Rendimiento: cada combinación de tamaño/colores se dibuja UNA vez en un lienzo aparte
  // y después solo se copia con drawImage (antes: gradiente + 4 trazos + arcos por panel y frame).
  panel(x, y, w, h, o = {}) {
    w = Math.round(w); h = Math.round(h);
    const key = `${w}|${h}|${o.cut || 7}|${o.top || ''}|${o.bottom || ''}|${o.border || ''}|${o.accent || ''}|${o.glow || ''}`;
    let bmp = this.panelCache.get(key);
    if (!bmp) {
      if (this.panelCache.size > 160) this.panelCache.clear();   // tamaños variables (tarjetas de texto)
      const dpr = devicePixelRatio || 1;
      bmp = document.createElement('canvas');
      bmp.width = Math.ceil((w + 4) * dpr); bmp.height = Math.ceil((h + 4) * dpr);
      const real = this.ctx;
      this.ctx = bmp.getContext('2d');
      this.ctx.scale(dpr, dpr);
      this.panelDraw(2, 2, w, h, o);
      this.ctx = real;
      bmp.dpr = dpr;
      this.panelCache.set(key, bmp);
    }
    this.ctx.drawImage(bmp, x - 2, y - 2, bmp.width / bmp.dpr, bmp.height / bmp.dpr);
  }

  panelDraw(x, y, w, h, o = {}) {
    const ctx = this.ctx, c = o.cut || 7;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + c, y); ctx.lineTo(x + w - c, y); ctx.lineTo(x + w, y + c); ctx.lineTo(x + w, y + h - c);
    ctx.lineTo(x + w - c, y + h); ctx.lineTo(x + c, y + h); ctx.lineTo(x, y + h - c); ctx.lineTo(x, y + c); ctx.closePath();
    const g = ctx.createLinearGradient(0, y, 0, y + h);   // solo al crear el bitmap
    g.addColorStop(0, o.top || 'rgba(26,34,56,0.92)'); g.addColorStop(1, o.bottom || 'rgba(10,14,26,0.92)');
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = o.border || '#33415f'; ctx.stroke();
    // bisel interior
    ctx.strokeStyle = 'rgba(160,190,255,0.12)'; ctx.lineWidth = 1;
    ctx.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);
    // luces de acento
    const red = o.accent || '#ff3040', cyan = o.glow || '#3ad8ff';
    ctx.shadowBlur = 0;
    ctx.shadowColor = red; ctx.strokeStyle = red; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + c + 2, y + 1); ctx.lineTo(x + Math.min(w * 0.35, 90), y + 1); ctx.stroke();
    ctx.shadowColor = cyan; ctx.strokeStyle = cyan;
    ctx.beginPath(); ctx.moveTo(x + w - Math.min(w * 0.3, 70), y + h - 1); ctx.lineTo(x + w - c - 2, y + h - 1); ctx.stroke();
    ctx.shadowBlur = 0;
    // remaches
    ctx.fillStyle = '#5a6a8a';
    for (const [rx, ry] of [[x + 5, y + h - 6], [x + w - 6, y + 5]]) { ctx.beginPath(); ctx.arc(rx, ry, 1.6, 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  // Barra con marco biselado, relleno con brillo y texto centrado.
  bar(x, y, w, h, v, col, label, back = '#151826') {
    const ctx = this.ctx;
    ctx.fillStyle = '#05070d'; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.strokeStyle = '#4a5878'; ctx.lineWidth = 1; ctx.strokeRect(x - 2.5, y - 2.5, w + 5, h + 5);
    ctx.fillStyle = back; ctx.fillRect(x, y, w, h);
    const fw = w * clamp(v, 0, 1);
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = this.grad(`bar|${h}|${col}`, () => { const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, col); g.addColorStop(1, shade(col, -0.35)); return g; });
    ctx.fillRect(0, 0, fw, h);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(x, y, fw, Math.max(1, h * 0.25));
    // marcas de segmento
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let sx = x + 24; sx < x + w; sx += 24) ctx.fillRect(sx, y, 1, h);
    if (label) {
      ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.max(9, Math.round(h * 0.72))}px Segoe UI`; ctx.textAlign = 'center';
      ctx.shadowColor = '#000'; ctx.shadowBlur = 0;
      ctx.fillText(label, x + w / 2, y + h * 0.78);
      ctx.shadowBlur = 0; ctx.textAlign = 'left';
    }
  }

  // Celdas iluminadas (armadura 0/3, místicos 0/2...).
  cells(x, y, n, lit, col, size = 12) {
    const ctx = this.ctx;
    for (let i = 0; i < n; i++) {
      const cx = x + i * (size + 4);
      ctx.fillStyle = '#0a0d16'; ctx.fillRect(cx, y, size, size * 0.7);
      ctx.strokeStyle = '#3a4a6a'; ctx.lineWidth = 1; ctx.strokeRect(cx + 0.5, y + 0.5, size - 1, size * 0.7 - 1);
      if (i < lit) {
        ctx.shadowColor = col; ctx.shadowBlur = 0; ctx.fillStyle = col;
        ctx.fillRect(cx + 2, y + 2, size - 4, size * 0.7 - 4);
        ctx.shadowBlur = 0;
      }
    }
    return n * (size + 4);
  }

  slotFrame(x, y, s, key, highlight) {
    const ctx = this.ctx, im = this.S.sprites.ui[key];
    ctx.imageSmoothingEnabled = false;
    if (im) ctx.drawImage(im, x, y, s, s);
    else { this.panel(x, y, s, s, { cut: 5 }); }
    if (highlight) {
      ctx.save(); ctx.shadowColor = highlight; ctx.shadowBlur = 0; ctx.strokeStyle = highlight; ctx.lineWidth = 2;
      ctx.strokeRect(x + 3, y + 3, s - 6, s - 6); ctx.restore();
    }
  }

  // Retrato pixel art: busto del primer frame de la hoja del héroe.
  portrait(charId, form, x, y, s, dim = false) {
    const ctx = this.ctx, sp = this.S.sprites, key = heroSpriteKey(charId, form);
    const c = this.S.chars[charId] || { color: '#555', color2: '#fff', letter: '?' };
    ctx.save();
    ctx.fillStyle = '#0b1020'; ctx.fillRect(x, y, s, s);
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = this.grad(`por|${s}|${c.color}`, () => { const g = ctx.createRadialGradient(s / 2, s * 0.4, 2, s / 2, s / 2, s * 0.7); g.addColorStop(0, shade(c.color, 0.1) + 'aa'); g.addColorStop(1, '#0b1020'); return g; });
    ctx.fillRect(0, 0, s, s);
    ctx.restore();
    ctx.beginPath(); ctx.rect(x, y, s, s); ctx.clip();
    if (key && sp.has(key)) {
      const e = sp.entry(key), cell = e.cell, an = e.anims.walk_down || e.anims.idle || Object.values(e.anims)[0];
      const crop = cell * 0.6;
      ctx.imageSmoothingEnabled = false;
      if (dim) ctx.globalAlpha = 0.45;
      ctx.drawImage(sp.img[key], (cell - crop) / 2, an.row * cell + cell * 0.06, crop, crop, x, y, s, s);
    } else {
      ctx.fillStyle = c.color; ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 0.36, 0, TAU); ctx.fill();
      ctx.fillStyle = c.color2; ctx.font = `bold ${Math.round(s * 0.4)}px Segoe UI`; ctx.textAlign = 'center';
      ctx.fillText(c.letter || '?', x + s / 2, y + s * 0.64); ctx.textAlign = 'left';
    }
    ctx.restore();
    ctx.strokeStyle = '#7a8ab0'; ctx.lineWidth = 2; ctx.strokeRect(x - 1, y - 1, s + 2, s + 2);
    ctx.strokeStyle = c.color2 || '#fff'; ctx.lineWidth = 1; ctx.strokeRect(x - 3.5, y - 3.5, s + 7, s + 7);
  }

  // ───────── Frame ─────────
  draw(snap, me, W, H, dt) {
    const ctx = this.ctx, S = this.S, room = snap.room;
    this.time = performance.now() / 1000;   // reloj real (el cartel no se alarga si bajan los FPS)
    this.hits = [];
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // Cartel de sala al entrar en una nueva.
    const roomKey = `${room.fl}:${room.nm}`;
    if (roomKey !== this.lastRoom) { this.lastRoom = roomKey; this.banner = { t0: this.time, text: room.nm, fl: room.fl }; }

    let y = this.drawProfile(snap, me, W);
    y = this.drawTeam(snap, y + 8);
    this.drawSynergies(snap, y + 6);
    this.drawTopCenter(snap, W);
    this.drawCurse(snap, W);
    this.drawTopRight(snap, me, W);
    if (me) this.drawHotbars(me, W, H);
    this.drawPickupCard(W, snap);
    this.drawDoorArrows(snap, me, W, H);
    this.drawMessages(snap, me, W, H);
    this.drawBanner(W, H);
    this.drawTooltip(W, H);
    if (me && (me.st & ST.confuse)) { ctx.fillStyle = 'rgba(255,210,31,0.08)'; ctx.fillRect(0, 0, W, H); }
    if (snap.cu && snap.cu[0] === 'mente') this.interference(W, H);
  }

  // Sobrecarga Cósmica: alerta con el sprite de la gema y la cuenta atrás.
  drawCurse(snap, W) {
    if (!snap.cu) return;
    const ctx = this.ctx, [g, t] = snap.cu, S = this.S;
    const C = (S.curses || {})[g] || { name: g, desc: '' }, col = (S.gems[g] || {}).color || '#fff';
    const w = 460, x = W / 2 - w / 2, y = (this.bossBarBottom || 50) + 4;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 10);
    this.panel(x, y, w, 46, { accent: col, glow: col, border: col });
    ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 0;
    if (!S.sprites.gems[g] || !this.gemImg(g, x + 8, y + 5, 36, true)) this.diamond(x + 26, y + 23, 12, col);
    ctx.restore();
    ctx.fillStyle = col; ctx.font = 'bold 13px Segoe UI'; ctx.fillText(`☄ SOBRECARGA CÓSMICA · ${C.name.toUpperCase()}`, x + 52, y + 18);
    ctx.fillStyle = '#e6e9f5'; ctx.font = '11px Segoe UI'; ctx.fillText(C.desc, x + 52, y + 33);
    ctx.fillStyle = col; ctx.fillRect(x + 52, y + 38, (w - 64) * clamp(t / 10, 0, 1), 3);
    ctx.textAlign = 'right'; ctx.font = 'bold 14px Segoe UI'; ctx.fillText(`${Math.ceil(t)} s`, x + w - 10, y + 20); ctx.textAlign = 'left';
    this.bossBarBottom = y + 50;
  }

  // Gema de la Mente: interferencia en pantalla.
  interference(W, H) {
    const ctx = this.ctx;
    ctx.save();
    for (let i = 0; i < 18; i++) {
      const y = Math.random() * H, h = 1 + Math.random() * 4;
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '255,210,31' : '200,220,255'},${0.05 + Math.random() * 0.1})`;
      ctx.fillRect(0, y, W, h);
    }
    ctx.fillStyle = 'rgba(255,210,31,0.04)'; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // Sprite de gema: a color (con brillo) si se posee; silueta apagada si no.
  // CUELLO DE BOTELLA CORREGIDO: antes aplicaba ctx.filter = 'grayscale(1) brightness(0.28)' en
  // cada frame a cada gema que faltaba (~28 ms/frame). Ahora la silueta se genera una sola vez.
  gemImg(g, x, y, s, has) {
    const im = this.S.sprites.gems[g];
    if (!im) return false;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    if (has) { ctx.drawImage(im, x, y, s, s); return true; }
    ctx.drawImage(this.gemSilhouette(g, im), x, y, s, s);
    return true;
  }

  gemSilhouette(g, im) {
    let c = this.gemCache[g];
    if (c) return c;
    c = document.createElement('canvas');
    c.width = im.width; c.height = im.height;
    const x = c.getContext('2d');
    x.drawImage(im, 0, 0);
    // Una sola pasada (fuera del bucle de render): gris oscuro con 75% de opacidad.
    const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const l = (p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11) * 0.28;
      p[i] = p[i + 1] = p[i + 2] = l; p[i + 3] *= 0.75;
    }
    x.putImageData(d, 0, 0);
    this.gemCache[g] = c;
    return c;
  }

  // Gradiente cacheado (definido en coordenadas locales: dibujar con ctx.translate).
  grad(key, make) {
    let g = this.gradCache.get(key);
    if (!g) { if (this.gradCache.size > 200) this.gradCache.clear(); g = make(); this.gradCache.set(key, g); }
    return g;
  }

  // Panel del héroe: retrato, nombre/tag, vida, escudo y celdas de recurso.
  drawProfile(snap, me, W) {
    if (!me) return 12;
    const ctx = this.ctx, S = this.S, c = S.chars[me.c] || { name: me.c, color2: '#fff' };
    const tags = this.resourceTags(me);
    const pw = Math.min(352, W - 24), ph = 96 + (tags.length > 2 ? 18 : 0);
    this.panel(12, 12, pw, ph);
    this.portrait(me.c, me.fm, 22, 22, 66, !!me.dn);
    const tx = 100;
    ctx.fillStyle = c.color2; ctx.font = 'bold 15px Segoe UI'; ctx.fillText(c.name.toUpperCase(), tx, 33);
    const nw = ctx.measureText(c.name.toUpperCase()).width;
    ctx.fillStyle = '#8a93b4'; ctx.font = '12px Segoe UI'; ctx.fillText(`@${me.n}`, tx + nw + 8, 33);
    ctx.fillStyle = '#ff4050'; ctx.font = 'bold 10px Segoe UI'; ctx.fillText('HP', tx, 51);
    this.bar(tx + 20, 40, pw - tx - 22, 14, me.hp / me.mh, me.bz ? '#ff3030' : me.as ? '#8fe8ff' : '#e8283c', `${me.hp} / ${me.mh}`);
    let ry = 60;
    if (me.sm > 0) {
      ctx.fillStyle = '#40d8ff'; ctx.font = 'bold 9px Segoe UI'; ctx.fillText('ESC', tx - 1, ry + 7);
      this.bar(tx + 20, ry, pw - tx - 22, 6, me.sh / me.sm, '#40d8ff');
      ry += 11;
    } else ry += 2;
    // Recursos: celdas iluminadas y chips de estado.
    let cx = tx, cy = ry + 4;
    for (const t of tags) {
      ctx.font = 'bold 10px Segoe UI';
      const lw = ctx.measureText(t.label).width;
      const need = lw + (t.cells ? t.cells * 16 + 6 : 0) + 14;
      if (cx + need > 12 + pw - 6) { cx = tx; cy += 18; }
      if (t.cells) cx += this.cells(cx, cy + 1, t.cells, t.lit, t.color) + 4;
      ctx.fillStyle = t.color; ctx.fillText(t.label, cx, cy + 9);
      cx += lw + 14;
    }
    return 12 + ph;
  }

  // Celdas/etiquetas específicas de cada héroe.
  resourceTags(me) {
    const S = this.S, inv = S.inv, tags = [];
    const tagCount = (tag) => inv.filter((id) => S.items[id]?.tags.includes(tag)).length;
    switch (me.c) {
      case 'ironman':
        if (me.fm === 'hulkbuster') tags.push({ label: 'HULK-BUSTER', color: '#f2c230', cells: 3, lit: 3 });
        else tags.push({ label: '→ Hulk-Buster', color: '#f2c230', cells: 3, lit: Math.min(3, tagCount('armor')) });
        break;
      case 'strange': { const n = tagCount('mystic'); tags.push({ label: n >= 2 ? 'Sello: inmunidad' : '→ inmunidad', color: '#ffb02e', cells: 2, lit: Math.min(2, n) }); break; }
      case 'ghostrider':
        if (me.fm === 'blue') tags.push({ label: 'FUEGO AZUL', color: '#4fc8ff' });
        if (me.ft > 0) tags.push({ label: `MOTO ${me.ft.toFixed(1)} s`, color: '#ff8a1a', cells: 5, lit: Math.ceil(me.ft / 1.6) });
        else tags.push({ label: `Moto ${me.bk}/15`, color: '#ffb060', cells: 5, lit: Math.floor(me.bk / 3) });
        break;
      case 'hulk':
        if (me.fm === 'banner') tags.push({ label: `BANNER ${Math.ceil(me.ft)} s`, color: '#b09aff', cells: 6, lit: Math.ceil(me.ft / 20) });
        else tags.push({ label: 'HULK', color: '#7fe04a' });
        break;
      case 'venom': tags.push({ label: me.m ? 'MODO SIGILO' : 'MODO TANQUE', color: '#e8e8f0' }); break;
      case 'wolverine': tags.push({ label: me.bz ? '¡BERSERKER!' : 'Regenerando', color: me.bz ? '#ff5050' : '#ffe14a' }); break;
      case 'spider2099': tags.push({ label: 'Disp. temporal', color: me.ur ? '#777' : '#6fd8ff', cells: 1, lit: me.ur ? 0 : 1 }); break;
      default: break;
    }
    if (me.as) tags.push({ label: 'FORMA ASTRAL (25%)', color: '#8fe8ff' });
    if (me.iv) tags.push({ label: 'INVISIBLE', color: '#9ff0b0' });
    if (me.av) tags.push({ label: '¡VENGADORES!', color: '#6a8cff' });
    if (me.sn) tags.push({ label: '¡ATURDIDO!', color: '#ffd76a' });
    if (me.sd) tags.push({ label: 'HAMBRE DEL ALMA: ¡consigue una baja!', color: '#ff9a1f' });
    if (this.S.snap && this.S.snap.gt) tags.push({ label: '✊ GUANTELETE', color: '#ffd76a' });
    return tags;
  }

  drawTeam(snap, y) {
    const ctx = this.ctx, S = this.S;
    for (const p of snap.P) {
      if (p.i === S.me) continue;
      this.panel(12, y, 230, 34, { cut: 5 });
      this.portrait(p.c, p.fm, 18, y + 5, 24, !!p.dn);
      ctx.fillStyle = p.dn ? '#ff8080' : p.as ? '#8fe8ff' : '#e6e9f5'; ctx.font = '12px Segoe UI';
      ctx.fillText(p.dn ? `${p.n} · CAÍDO ${Math.ceil(p.dt)} s` : p.as ? `${p.n} · ASTRAL` : p.n, 50, y + 15);
      this.bar(50, y + 21, 182, 5, p.dn ? p.rv : p.hp / p.mh, p.dn ? '#7fff9a' : '#e8283c');
      y += 40;
    }
    return y;
  }

  // Sinergias cooperativas activas (insignias).
  drawSynergies(snap, y) {
    const ctx = this.ctx, S = this.S;
    const list = (snap.sy || []).map((id) => (S.synergies || []).find((s) => s.id === id)).filter(Boolean);
    let x = 12;
    for (const s of list) {
      ctx.font = 'bold 11px Segoe UI';
      const w = ctx.measureText(s.name).width + 26;
      this.panel(x, y, w, 20, { cut: 4, accent: s.color, glow: s.color, border: s.color + '88' });
      ctx.fillStyle = s.color; ctx.fillText('🤝 ' + s.name, x + 6, y + 14);
      this.hits.push({ x, y, w, h: 20, type: 'syn', id: s.id });
      x += w + 6;
    }
  }

  drawTopCenter(snap, W) {
    const ctx = this.ctx, S = this.S, room = snap.room;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd76a'; ctx.font = 'bold 15px Segoe UI';
    ctx.shadowColor = '#000'; ctx.shadowBlur = 0;
    ctx.fillText(`PISO ${room.fl} · ${room.nm}`, W / 2, 24);
    ctx.font = '13px Segoe UI'; ctx.fillStyle = '#cfd8ff';
    let sub = '';
    if (room.cl) sub = 'Sala despejada — entrad juntos en un portal (también se puede volver atrás)';
    else if (room.ty === 'challenge') sub = room.cf ? '⏱ Tiempo agotado: sin gema' : `⏱ DESAFÍO: ${Math.ceil(room.ct)} s · Oleada ${Math.max(1, room.wv[0])}/${room.wv[1]}`;
    else if (room.am) sub = `⚠ EMBOSCADA · Oleada ${Math.max(1, room.wv[0])}/${room.wv[1]}`;
    else if (room.ty === 'combat' || room.ty === 'vault' || room.ty === 'secret') sub = `Oleada ${Math.max(1, room.wv[0])}/${room.wv[1]}`;
    if (room.ty === 'challenge' && !room.cl && !room.cf && room.ct < 10) ctx.fillStyle = '#ff6060';
    if (sub) ctx.fillText(sub, W / 2, 42);
    ctx.shadowBlur = 0;
    // Barras de jefe (una por jefe: las arenas avanzadas tienen jefes dobles)
    const ids = snap.bs && snap.bs.length ? snap.bs : [snap.boss];
    const bossList = ids.map((id) => snap.E.find((e) => e[0] === id)).filter(Boolean);
    this.bossBarBottom = 50;
    const bw = clamp(W - 560, 240, 560), bx = W / 2 - bw / 2;
    bossList.forEach((boss, k) => {
      const b = S.bosses[boss[1]];
      const by = 52 + k * 42;
      this.panel(bx - 12, by, bw + 24, 38, { accent: b.color, glow: '#ff5050' });
      ctx.fillStyle = b.color; ctx.font = 'bold 13px Segoe UI';
      ctx.fillText(`${b.name.toUpperCase()} — ${b.title}`, W / 2, by + 15);
      this.bar(bx, by + 21, bw, 9, boss[4] / boss[5], b.color);
      this.bossBarBottom = by + 42;
    });
    ctx.textAlign = 'left';
  }

  // Gemas + botón de silencio + minimapa.
  drawTopRight(snap, me, W) {
    const ctx = this.ctx, S = this.S;
    const gx0 = W - 12 - 6 * 28 - 8;
    this.panel(gx0 - 74, 10, W - 12 - (gx0 - 74), 42, { cut: 5, accent: snap.gt ? '#ffd76a' : undefined, glow: snap.gt ? '#ffd76a' : undefined });
    // botón de configuración (⚙ audio)
    const sx0 = gx0 - 68, sy0 = 16;
    ctx.fillStyle = '#14223a'; ctx.fillRect(sx0, sy0, 28, 28);
    ctx.strokeStyle = '#ffd76a'; ctx.lineWidth = 1.5; ctx.strokeRect(sx0 + 0.5, sy0 + 0.5, 27, 27);
    ctx.fillStyle = '#ffd76a'; ctx.font = 'bold 18px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('⚙', sx0 + 14, sy0 + 21); ctx.textAlign = 'left';
    this.hits.push({ x: sx0, y: sy0, w: 28, h: 28, type: 'settings' });
    // botón de silencio
    const mx = gx0 - 34, my = 16;
    const muted = S.audio.isMuted;
    ctx.fillStyle = muted ? '#3a1a22' : '#14223a'; ctx.fillRect(mx, my, 28, 28);
    ctx.strokeStyle = muted ? '#ff5060' : '#3ad8ff'; ctx.lineWidth = 1.5; ctx.strokeRect(mx + 0.5, my + 0.5, 27, 27);
    ctx.fillStyle = muted ? '#ff7080' : '#9fe8ff';
    ctx.beginPath(); ctx.moveTo(mx + 6, my + 11); ctx.lineTo(mx + 10, my + 11); ctx.lineTo(mx + 15, my + 6); ctx.lineTo(mx + 15, my + 22); ctx.lineTo(mx + 10, my + 17); ctx.lineTo(mx + 6, my + 17); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 2;
    if (muted) { ctx.beginPath(); ctx.moveTo(mx + 18, my + 10); ctx.lineTo(mx + 24, my + 18); ctx.moveTo(mx + 24, my + 10); ctx.lineTo(mx + 18, my + 18); ctx.stroke(); }
    else { ctx.beginPath(); ctx.arc(mx + 15, my + 14, 5, -0.8, 0.8); ctx.stroke(); ctx.beginPath(); ctx.arc(mx + 15, my + 14, 9, -0.8, 0.8); ctx.stroke(); }
    this.hits.push({ x: mx, y: my, w: 28, h: 28, type: 'mute' });
    // gemas
    // Poder del Guantelete: halo multicolor tras las 6 gemas.
    if (snap.gt) {
      ctx.save(); ctx.translate(gx0, 0); ctx.globalAlpha = 0.35 + 0.2 * Math.sin(this.time * 4);
      ctx.fillStyle = this.grad('gauntlet', () => { const grd = ctx.createLinearGradient(0, 0, 6 * 28, 0); GEM_COLORS.forEach((c, i) => grd.addColorStop(i / 5, c)); return grd; });
      ctx.fillRect(0, 14, 6 * 28, 34); ctx.restore();
    }
    S.gemOrder.forEach((g, i) => {
      const gm = S.gems[g], has = snap.gems.includes(g);
      const gx = gx0 + 14 + i * 28, gy = 31;
      if (S.sprites.gems[g]) {
        const s = has ? 26 + 2 * Math.sin(this.time * 4 + i) : 24;
        ctx.save();
        if (has) { ctx.shadowColor = gm.color; ctx.shadowBlur = 0; }
        this.gemImg(g, gx - s / 2, gy - s / 2, s, has);
        ctx.restore();
        this.hits.push({ x: gx - 13, y: gy - 13, w: 26, h: 26, type: 'gem', id: g });
        return;
      }
      ctx.save(); ctx.translate(gx, gy);
      ctx.fillStyle = has ? gm.color : 'rgba(255,255,255,0.06)';
      ctx.strokeStyle = gm.color; ctx.lineWidth = 2;
      if (has) { ctx.shadowColor = gm.color; ctx.shadowBlur = 0; }
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(8, 0); ctx.lineTo(0, 10); ctx.lineTo(-8, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    });
    if (snap.cu && snap.cu[0] === 'mente') this.minimapJammed(W - 12 - 224, 58, 224, 150);
    else this.drawMinimap(W - 12 - 224, 58, 224, 150);
  }

  // Gema de la Mente: el minimapa se bloquea con estática.
  minimapJammed(x, y, w, h) {
    const ctx = this.ctx;
    this.panel(x, y, w, h, { glow: '#ffd21f', accent: '#ffd21f' });
    for (let i = 0; i < 70; i++) {
      const v = Math.floor(Math.random() * 200);
      ctx.fillStyle = `rgb(${v},${v},${Math.min(255, v + 30)})`;
      ctx.fillRect(x + 8 + Math.random() * (w - 16), y + 20 + Math.random() * (h - 30), 3, 2);
    }
    ctx.fillStyle = '#ffd21f'; ctx.font = 'bold 12px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText('⚠ INTERFERENCIA MENTAL', x + w / 2, y + h / 2 + 4); ctx.textAlign = 'left';
  }

  // Minimapa táctico: salas del piso (fila principal + ramas), visitadas y adyacentes.
  drawMinimap(x, y, w, h) {
    const ctx = this.ctx, map = this.S.map;
    this.panel(x, y, w, h, { glow: '#3ad8ff' });
    ctx.fillStyle = '#9fb4e0'; ctx.font = 'bold 10px Segoe UI';
    ctx.fillText(map ? `MINIMAPA · PISO ${map.fl}` : 'MINIMAPA', x + 10, y + 15);
    if (!map) return;
    const rooms = map.rooms;
    const minX = Math.min(...rooms.map((r) => r.x)), maxX = Math.max(...rooms.map((r) => r.x));
    const minY = Math.min(...rooms.map((r) => r.y)), maxY = Math.max(...rooms.map((r) => r.y));
    const cw = 30, ch = 18, gx = 14, gy = 10;
    const tw = (maxX - minX + 1) * cw + (maxX - minX) * gx, th = (maxY - minY + 1) * ch + (maxY - minY) * gy;
    const ox = x + (w - tw) / 2, oy = y + 22 + (h - 44 - th) / 2;
    const pos = (r) => [ox + (r.x - minX) * (cw + gx), oy + (r.y - minY) * (ch + gy)];
    const cur = rooms.find((r) => r.id === map.cur);
    // conexiones
    ctx.strokeStyle = '#3a4a6a'; ctx.lineWidth = 2;
    for (const r of rooms) {
      const [rx, ry] = pos(r);
      if (r.y === 0 && rooms.some((q) => q.y === 0 && q.x === r.x + 1)) { ctx.beginPath(); ctx.moveTo(rx + cw, ry + ch / 2); ctx.lineTo(rx + cw + gx, ry + ch / 2); ctx.stroke(); }
      if (r.y !== 0) {
        const main = rooms.find((q) => q.y === 0 && q.x === r.x);
        if (main) { const [mx2, my2] = pos(main); ctx.beginPath(); ctx.moveTo(rx + cw / 2, r.y < 0 ? ry + ch : ry); ctx.lineTo(mx2 + cw / 2, r.y < 0 ? my2 : my2 + ch); ctx.stroke(); }
      }
    }
    // salas
    for (const r of rooms) {
      const [rx, ry] = pos(r);
      const adjacent = cur && ((r.y === 0 && cur.y === 0 && Math.abs(r.x - cur.x) === 1) || (r.x === cur.x && (r.y === 0 || cur.y === 0)));
      const isCur = r.id === map.cur;
      ctx.fillStyle = isCur ? '#1d4a7a' : r.v ? '#22365a' : adjacent ? '#172238' : '#0e1424';
      ctx.fillRect(rx, ry, cw, ch);
      ctx.strokeStyle = isCur ? '#3ad8ff' : r.v ? '#4a6a9a' : adjacent ? '#34466a' : '#232c44';
      ctx.lineWidth = isCur ? 2 : 1; ctx.strokeRect(rx + 0.5, ry + 0.5, cw - 1, ch - 1);
      const mx = rx + cw / 2, my = ry + ch / 2;
      if (r.k === 'boss') this.diamond(mx, my, 6, '#ffb52e');
      else if (r.k === 'boss2') { this.diamond(mx - 4, my, 5, '#ffb52e'); this.diamond(mx + 4, my, 5, '#ff5a3a'); }
      else if (r.k === 'challenge') { ctx.fillStyle = '#ff5aa0'; ctx.font = 'bold 11px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('⏱', mx, my + 4); ctx.textAlign = 'left'; }
      else if (r.k === 'treasure') { ctx.fillStyle = '#ffd76a'; ctx.fillRect(mx - 4, my - 3, 8, 6); }
      else if (r.k === 'vault') { ctx.strokeStyle = '#5aa0ff'; ctx.lineWidth = 2; ctx.strokeRect(mx - 4, my - 4, 8, 8); }
      else if (r.k === 'secret') this.star(mx, my, 6, '#c070ff');
      // Salidas abiertas (portales bidireccionales) desde la sala actual.
      const ex = map.exits || [];
      if (ex.includes(r.id) || (isCur && (ex.includes('floor') || ex.includes('victory')))) {
        ctx.strokeStyle = '#4fe08a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(mx + (isCur ? 9 : 0), my, 5, 0, TAU); ctx.stroke();
      }
      if (r.cl && !isCur) { ctx.fillStyle = '#7fffb0'; ctx.font = 'bold 8px Segoe UI'; ctx.fillText('✔', rx + cw - 9, ry + 8); }
      if (r.am) { ctx.fillStyle = '#ff4040'; ctx.font = 'bold 10px Segoe UI'; ctx.fillText('!', rx + 3, ry + 10); }
      if (map.goblin === r.id) {   // sala a la que huyó el Goblin
        const gp = 0.6 + 0.4 * Math.sin(this.time * 8);
        ctx.fillStyle = `rgba(192,138,255,${gp})`; ctx.beginPath(); ctx.arc(rx + cw - 4, ry + ch - 4, 5, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 8px Segoe UI'; ctx.fillText('$', rx + cw - 7, ry + ch - 1);
      }
      if (isCur) {
        const pulse = 0.7 + 0.3 * Math.sin(this.time * 6);
        ctx.fillStyle = `rgba(58,216,255,${pulse})`;
        ctx.beginPath(); ctx.moveTo(mx - (r.k === 'boss' ? 9 : 0), my - 6); ctx.lineTo(mx + 5 - (r.k === 'boss' ? 9 : 0), my + 5); ctx.lineTo(mx - 5 - (r.k === 'boss' ? 9 : 0), my + 5); ctx.closePath(); ctx.fill();
      }
    }
    // leyenda
    const ly = y + h - 10;
    ctx.font = '9px Segoe UI';
    let lx = x + 10;
    const leg = (draw, label) => { draw(lx + 4, ly - 3); ctx.fillStyle = '#9fb4e0'; ctx.fillText(label, lx + 11, ly); lx += ctx.measureText(label).width + 20; };
    leg((a, b) => { ctx.fillStyle = '#3ad8ff'; ctx.beginPath(); ctx.moveTo(a, b - 4); ctx.lineTo(a + 4, b + 3); ctx.lineTo(a - 4, b + 3); ctx.fill(); }, 'Tú');
    leg((a, b) => this.diamond(a, b, 4, '#ffb52e'), 'Jefe');
    leg((a, b) => { ctx.strokeStyle = '#4fe08a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(a, b, 3.5, 0, TAU); ctx.stroke(); }, 'Salida');
    leg((a, b) => this.star(a, b, 4, '#c070ff'), 'Secreta');
  }

  diamond(x, y, s, col) {
    const ctx = this.ctx;
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); ctx.fill();
  }

  star(x, y, s, col) {
    const ctx = this.ctx;
    ctx.fillStyle = col; ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? s * 0.45 : s; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    ctx.closePath(); ctx.fill();
  }

  // Hotbar de habilidades + inventario de 6 ranuras (abajo al centro).
  drawHotbars(me, W, H) {
    const ctx = this.ctx, S = this.S, c = S.chars[me.c] || {};
    const as = 54, is = 48, gap = 6, sep = 22;
    const total = 3 * as + 2 * gap + sep + 6 * is + 5 * gap;
    const x0 = Math.max(8, W / 2 - total / 2), y0 = H - as - 14;
    this.panel(x0 - 10, y0 - 10, total + 20, as + 22, { glow: '#3ad8ff' });
    // Habilidades
    const icoKey = me.fm === 'hulkbuster' ? 'hulkbuster' : me.fm === 'banner' ? 'banner' : me.c === 'ghostrider' && me.fm === 'blue' ? 'ghostrider_blue' : me.c;
    const icons = ABILITY_ICONS[icoKey] || ['SonicPulse', 'ExplosionBoom'];
    const defs = [['ESP', 'Dash', null, 'slot'], ['SHIFT', 'Habilidad', icons[0], 'slot_rare'], ['Q', c.noUlt ? 'Pasiva' : 'Ulti', icons[1], 'slot_epic']];
    defs.forEach(([key, label, icon, frame], i) => {
      const x = x0 + i * (as + gap), y = y0;
      const cd = me.cd[i], cm = me.cm[i] || 1;
      const ready = cd <= 0 && !(i === 2 && c.noUlt);
      this.slotFrame(x, y, as, frame, ready ? (i === 0 ? '#3ad8ff' : i === 1 ? '#ffb02e' : '#7fe04a') : null);
      ctx.save();
      if (!ready) ctx.globalAlpha = 0.55;
      if (i === 0) this.dashIcon(x + as / 2, y + as / 2, me);
      else if (!(i === 2 && c.noUlt)) this.S.sprites.drawFx(ctx, icon, x + as / 2, y + as / 2, as * 0.62, 0);
      ctx.restore();
      if (cd > 0 && cm > 0) {
        const k = clamp(cd / cm, 0, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.62)'; ctx.fillRect(x + 6, y + 6 + (as - 12) * (1 - k), as - 12, (as - 12) * k);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 16px Segoe UI'; ctx.textAlign = 'center';
        ctx.shadowColor = '#000'; ctx.shadowBlur = 0;
        ctx.fillText(cd >= 10 ? Math.ceil(cd) : cd.toFixed(1), x + as / 2, y + as / 2 + 6);
        ctx.shadowBlur = 0; ctx.textAlign = 'left';
      }
      ctx.fillStyle = '#05070d'; ctx.fillRect(x + 3, y + 3, ctx.measureText(key).width + 10, 13);
      ctx.fillStyle = '#ffd76a'; ctx.font = 'bold 9px Segoe UI'; ctx.fillText(key, x + 6, y + 13);
      ctx.fillStyle = '#9fb4e0'; ctx.font = '9px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText(label, x + as / 2, y + as + 9); ctx.textAlign = 'left';
    });
    // separador
    const sx = x0 + 3 * as + 2 * gap + sep / 2;
    ctx.strokeStyle = '#3a4a6a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx, y0 + 4); ctx.lineTo(sx, y0 + as - 4); ctx.stroke();
    // Inventario (6)
    const ix0 = x0 + 3 * as + 2 * gap + sep, iy = y0 + (as - is) / 2;
    for (let i = 0; i < 6; i++) {
      const x = ix0 + i * (is + gap);
      const id = S.inv[i], it = id && S.items[id];
      const sel = S.selSlot === i;
      if (!it) {
        ctx.globalAlpha = 0.45; this.slotFrame(x, iy, is, 'slot', null); ctx.globalAlpha = 1;
        ctx.fillStyle = '#4a5878'; ctx.font = '9px Segoe UI'; ctx.fillText(String(i + 1), x + 6, iy + 14);
      } else {
        this.slotFrame(x, iy, is, SLOT_FOR[it.rarity] || 'slot', sel ? '#ffe14a' : null);
        const icon = it.icon && S.sprites.items[it.icon];
        ctx.imageSmoothingEnabled = false;
        if (icon) ctx.drawImage(icon, x + 8, iy + 8, is - 16, is - 16);
        else { ctx.fillStyle = RARITY[it.rarity]; ctx.font = 'bold 18px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('✦', x + is / 2, iy + is / 2 + 6); ctx.textAlign = 'left'; }
        ctx.fillStyle = RARITY[it.rarity] || '#fff'; ctx.fillRect(x + 8, iy + is - 6, is - 16, 2);
        if (sel) { ctx.fillStyle = '#ffe14a'; ctx.font = 'bold 9px Segoe UI'; ctx.fillText('G', x + is - 12, iy + 13); }
      }
      this.hits.push({ x, y: iy, w: is, h: is, type: 'slot', i });
    }
    ctx.fillStyle = '#7a86a8'; ctx.font = '9px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText(`INVENTARIO ${S.inv.length}/6 · G soltar · Shift+clic / clic central en ranura`, ix0 + (6 * is + 5 * gap) / 2, y0 + as + 9);
    ctx.textAlign = 'left';
  }

  dashIcon(x, y, me) {
    const ctx = this.ctx;
    if (me.c === 'ghostrider' && this.S.sprites.drawFx(ctx, 'GhostRiderDash', x, y + 4, 40, 0)) return;
    ctx.strokeStyle = '#3ad8ff'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.shadowColor = '#3ad8ff'; ctx.shadowBlur = 0;
    for (const dx of [-8, 4]) { ctx.beginPath(); ctx.moveTo(x + dx - 4, y - 9); ctx.lineTo(x + dx + 5, y); ctx.lineTo(x + dx - 4, y + 9); ctx.stroke(); }
    ctx.shadowBlur = 0; ctx.lineCap = 'butt';
  }

  // Aviso del último ítem recogido (icono + nombre + efecto).
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
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = '13px Segoe UI';
    const w = clamp(ctx.measureText(it.desc).width + 96, 300, 580);
    const x = W / 2 - w / 2, y = (this.bossBarBottom || 50) + 6;
    this.panel(x, y, w, 60, { accent: col, glow: col, border: col + 'aa' });
    this.slotFrame(x + 8, y + 6, 48, SLOT_FOR[it.rarity] || 'slot', null);
    const icon = it.icon && this.S.sprites.items[it.icon];
    ctx.imageSmoothingEnabled = false;
    if (icon) ctx.drawImage(icon, x + 16, y + 14, 32, 32);
    ctx.fillStyle = '#7fffb0'; ctx.font = 'bold 10px Segoe UI'; ctx.fillText('¡OBJETO RECOGIDO!', x + 66, y + 16);
    ctx.fillStyle = col; ctx.font = 'bold 14px Segoe UI'; ctx.fillText(it.name, x + 66, y + 33);
    ctx.fillStyle = '#e6e9f5'; ctx.font = '12px Segoe UI'; ctx.fillText(it.desc, x + 66, y + 50);
    ctx.restore();
  }

  // Tooltip al pasar el cursor por una ranura o un ítem del suelo.
  drawTooltip(W, H) {
    const S = this.S, ctx = this.ctx;
    let id = null, fromSlot = false;
    const h = this.hitTest(S.mouse.x, S.mouse.y);
    if (h && h.type === 'slot' && S.inv[h.i]) { id = S.inv[h.i]; fromSlot = true; }
    else if (h && h.type === 'syn') { this.synTooltip(h.id, W, H); return; }
    else if (h && h.type === 'gem') { this.gemTooltip(h.id, W, H); return; }
    else if (this.r.hoverItem) id = this.r.hoverItem;
    const it = id && S.items[id];
    if (!it) return;
    const col = RARITY[it.rarity] || '#fff';
    const lines = [];
    for (const [k, v] of Object.entries(it.mods || {})) {
      if (!v) continue;
      const pct = k === 'regen' ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%` : (k === 'cd' || k === 'dashCd') ? `-${Math.round(v * 100)}%` : `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
      lines.push([`${pct} ${MOD_LABEL[k] || k}`, v > 0 ? '#9fffb0' : '#ff9a9a']);
    }
    if (it.active === 'grenade') lines.push(['Granada gamma automática cada 5 s', '#7fe04a']);
    if (it.active === 'drone') lines.push(['Dron que dispara al enemigo cercano', '#9fe8ff']);
    if (it.poison) lines.push([`${Math.round(it.poison * 100)}% prob. de envenenar`, '#7dff4a']);
    const tags = (it.tags || []).map((t) => ({ armor: 'Armadura', mystic: 'Místico', dark: 'Oscuro', symbiote: 'Simbionte' }[t] || t));
    ctx.font = '12px Segoe UI';
    const descW = ctx.measureText(it.desc).width;
    const w = clamp(Math.max(descW, ...lines.map(([l]) => ctx.measureText(l).width)) + 24, 220, 360);
    const descLines = wrap(ctx, it.desc, w - 20);
    const hgt = 46 + descLines.length * 15 + lines.length * 15 + (tags.length ? 16 : 0) + (fromSlot ? 18 : 0);
    let x = S.mouse.x + 16, y = S.mouse.y - hgt - 10;
    x = clamp(x, 8, W - w - 8); y = clamp(y, 8, H - hgt - 8);
    this.panel(x, y, w, hgt, { accent: col, glow: col, border: col + 'aa' });
    ctx.fillStyle = col; ctx.font = 'bold 14px Segoe UI'; ctx.fillText(it.name, x + 10, y + 20);
    ctx.fillStyle = '#9fb4e0'; ctx.font = 'bold 10px Segoe UI'; ctx.fillText(RARITY_NAME[it.rarity] || it.rarity, x + 10, y + 34);
    let ly = y + 50;
    ctx.fillStyle = '#e6e9f5'; ctx.font = '12px Segoe UI';
    for (const l of descLines) { ctx.fillText(l, x + 10, ly); ly += 15; }
    for (const [l, c] of lines) { ctx.fillStyle = c; ctx.fillText(l, x + 10, ly); ly += 15; }
    if (tags.length) { ctx.fillStyle = '#ffb02e'; ctx.font = 'bold 10px Segoe UI'; ctx.fillText(tags.join(' · '), x + 10, ly); ly += 16; }
    if (fromSlot) { ctx.fillStyle = '#7a86a8'; ctx.font = '10px Segoe UI'; ctx.fillText('G / Shift+clic / clic central: soltar', x + 10, ly + 2); }
  }

  gemTooltip(g, W, H) {
    const S = this.S, gm = S.gems[g], C = (S.curses || {})[g];
    if (!gm) return;
    const ctx = this.ctx, has = S.snap && S.snap.gems.includes(g);
    const lines = [[has ? 'Obtenida' : 'Sin obtener — desafíos, jefes dobles, Sala Secreta, Bóvedas', has ? '#9fffb0' : '#9fb4e0'], [`Bonus: ${gm.buff}`, '#e6e9f5']];
    if (C) lines.push([`Sobrecarga: ${C.name} — ${C.desc}`, '#ff9a9a']);
    ctx.font = '12px Segoe UI';
    const w = Math.max(...lines.map(([l]) => ctx.measureText(l).width)) + 24;
    const x = clamp(S.mouse.x - w + 20, 8, W - w - 8), y = clamp(S.mouse.y + 18, 8, H - 90);
    this.panel(x, y, w, 30 + lines.length * 16, { accent: gm.color, glow: gm.color });
    ctx.fillStyle = gm.color; ctx.font = 'bold 13px Segoe UI'; ctx.fillText(gm.name, x + 10, y + 18);
    lines.forEach(([l, c], i) => { ctx.fillStyle = c; ctx.font = '12px Segoe UI'; ctx.fillText(l, x + 10, y + 36 + i * 16); });
  }

  synTooltip(id, W, H) {
    const s = (this.S.synergies || []).find((q) => q.id === id);
    if (!s) return;
    const ctx = this.ctx;
    ctx.font = '12px Segoe UI';
    const w = ctx.measureText(s.desc).width + 24, x = clamp(this.S.mouse.x + 14, 8, W - w - 8), y = clamp(this.S.mouse.y + 14, 8, H - 60);
    this.panel(x, y, w, 50, { accent: s.color, glow: s.color });
    ctx.fillStyle = s.color; ctx.font = 'bold 13px Segoe UI'; ctx.fillText(`Sinergia: ${s.name}`, x + 10, y + 19);
    ctx.fillStyle = '#e6e9f5'; ctx.font = '12px Segoe UI'; ctx.fillText(s.desc, x + 10, y + 37);
  }

  // Flechas hacia los portales fuera de pantalla.
  drawDoorArrows(snap, me, W, H) {
    if (!snap.room.cl || !me) return;
    const ctx = this.ctx, cam = this.S.cam;
    for (const d of snap.D) {
      if (d[8]) continue;
      const sx = (d[1] - cam.x) * cam.scale + W / 2, sy = (d[2] - cam.y) * cam.scale + H / 2;
      if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
      const a = Math.atan2(sy - H / 2, sx - W / 2);
      const ax = clamp(sx, 40, W - 40), ay = clamp(sy, 40, H - 110);
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(a);
      ctx.fillStyle = DOOR_COLOR[d[5]] || '#fff'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9); ctx.fill();
      ctx.restore();
    }
  }

  drawMessages(snap, me, W, H) {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    if (me && me.dn) {
      ctx.fillStyle = '#ff8080'; ctx.font = 'bold 22px Segoe UI';
      ctx.fillText(`Has caído — un aliado debe mantener [F] 10 s a tu lado (${Math.round(me.rv * 100)}%)`, W / 2, H / 2 + 90);
      ctx.font = 'bold 16px Segoe UI'; ctx.fillStyle = '#8fe8ff';
      ctx.fillText(`Forma Astral en ${Math.ceil(me.dt)} s`, W / 2, H / 2 + 116);
    } else if (me && me.as) {
      ctx.fillStyle = '#8fe8ff'; ctx.font = 'bold 18px Segoe UI';
      ctx.fillText('FORMA ASTRAL: 25% de daño e intangible hasta limpiar la sala', W / 2, H - 100);
    } else if (me) {
      const near = snap.P.find((o) => o.dn && o.i !== me.i && Math.hypot(o.x - me.x, o.y - me.y) < 75);
      if (near) {
        this.panel(W / 2 - 200, H / 2 + 66, 400, 38, { accent: '#7fff9a', glow: '#7fff9a' });
        ctx.fillStyle = me.rf ? '#7fff9a' : '#ffd76a'; ctx.font = 'bold 17px Segoe UI';
        ctx.fillText(me.rf ? `Reanimando a ${near.n}… ${Math.round(near.rv * 100)}%` : `Mantén [F] para reanimar a ${near.n}`, W / 2, H / 2 + 91);
      }
    }
    ctx.textAlign = 'left';
  }

  // Cartel con el nombre de la sala al entrar.
  drawBanner(W, H) {
    const b = this.banner;
    if (!b) return;
    const t = this.time - b.t0;
    if (t > 2.6) { this.banner = null; return; }
    const a = t < 0.35 ? t / 0.35 : t > 2 ? (2.6 - t) / 0.6 : 1;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    const y = H * 0.3;
    ctx.save(); ctx.translate(W / 2 - 320, y - 34);
    ctx.fillStyle = this.grad('banner', () => { const g = ctx.createLinearGradient(0, 0, 640, 0); g.addColorStop(0, 'rgba(10,14,26,0)'); g.addColorStop(0.5, 'rgba(10,14,26,0.85)'); g.addColorStop(1, 'rgba(10,14,26,0)'); return g; });
    ctx.fillRect(0, 0, 640, 56);
    ctx.restore();
    ctx.fillStyle = '#ff3040'; ctx.fillRect(W / 2 - 160 * a, y - 34, 320 * a, 2);
    ctx.fillStyle = '#3ad8ff'; ctx.fillRect(W / 2 - 160 * a, y + 20, 320 * a, 2);
    ctx.fillStyle = '#ffd76a'; ctx.font = 'bold 11px Segoe UI'; ctx.fillText(`PISO ${b.fl}`, W / 2, y - 16);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 22px Segoe UI'; ctx.shadowColor = '#ff3040'; ctx.shadowBlur = 0;
    ctx.fillText(b.text.toUpperCase(), W / 2, y + 10);
    ctx.restore();
  }

  // Transición entre salas: iris que se cierra sobre un portal giratorio.
  drawTransition(tr, W, H, dt) {
    this.trA = clamp(this.trA + (tr ? dt * 2.2 : -dt * 2.5), 0, 1);
    const a = this.trA;
    if (a <= 0) return;
    const ctx = this.ctx;
    const R = Math.hypot(W, H) * 0.6 * (1 - a) + 40 * a;
    ctx.save();
    ctx.fillStyle = '#05060a';
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(W / 2, H / 2, R, 0, TAU, true); ctx.fill('evenodd');
    ctx.globalAlpha = a;
    this.S.sprites.drawFx(ctx, 'VoidPortal', W / 2, H / 2, 140 + 80 * a, this.time * 3);
    ctx.restore();
  }
}

function wrap(ctx, text, maxW) {
  const words = String(text).split(' '), out = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

// Aclara/oscurece un color hex (#rrggbb) en una fracción k (-1..1).
function shade(hex, k) {
  const m = /^#?([0-9a-f]{6})/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (c) => Math.round(clamp(k < 0 ? c * (1 + k) : c + (255 - c) * k, 0, 255));
  const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
