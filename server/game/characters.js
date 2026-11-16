'use strict';
// Personajes BASE (disponibles desde el inicio): Iron Man, Ghost Rider, Hulk y Doctor Strange.
// Los desbloqueables (Spider-Man, Capitán América, Thor y los 5 ocultos) están en characters_hidden.js.
// Controles: Click = ataque · Espacio = dash · Shift / Click der. = habilidad · Q = ulti · F = reanimar
//
// Formas (p.form): cambian stats (modStats), ataques y el sprite que dibuja el cliente.
//   ironman: 'mk' → 'hulkbuster' (3+ ítems de armadura)
//   ghostrider: 'normal' → 'blue' (Fuego Azul de Zadkiel)
//   hulk: 'hulk' → 'banner' (1ª caída, 120 s) → 'hulk'
// Una habilidad/ulti que devuelve false no consume enfriamiento.
const HIDDEN = require('./characters_hidden');
const { countTag } = require('./items');

const TAU = Math.PI * 2;

const BASE = {
  // ── Iron Man ── evoluciona a Hulk-Buster con 3+ ítems de armadura.
  ironman: {
    id: 'ironman', name: 'Iron Man', color: '#b8231f', color2: '#f2c230', letter: 'I',
    hp: 110, speed: 215, crit: 0.05, armor: 0.1, abilityCd: 6, ultCd: 24,
    desc: 'Artillería pesada. Con 3 ítems de armadura evoluciona a la Hulk-Buster.',
    kit: {
      attack: 'Rayo repulsor · Hulk-Buster: puñetazo demoledor',
      ability: 'Salva de 5 micromisiles (metálicos) · Hulk-Buster: pisotón sísmico',
      ult: 'Unirrayo: láser que atraviesa todo',
      passive: 'Evolución: 3+ ítems de armadura → Hulk-Buster (+60% vida, +15% defensa, más lento)',
    },
    init(w, p) { p.form = 'mk'; },
    modStats(p) {
      if (p.form === 'hulkbuster') { p.maxHp = Math.round(p.maxHp * 1.6); p.armor += 0.15; p.speed *= 0.85; }
    },
    onItem(w, p) {
      if (p.form !== 'hulkbuster' && countTag(p.items, 'armor') >= 3) {
        p.form = 'hulkbuster';
        p.r = 22;
        w.recalc(p);
        p.hp = p.maxHp;
        w.fx.push({ k: 'ring', x: p.x, y: p.y, r: 160, c: '#f2c230' });
        w.toast(`🛡 ${p.name}: ¡protocolo VERÓNICA! Iron Man evoluciona a la HULK-BUSTER`, '#f2c230');
      }
    },
    attackRate(p) { return p.form === 'hulkbuster' ? 0.55 : 0.28; },
    attack(w, p) {
      if (p.form === 'hulkbuster') w.meleeArc(p, 96, 1.8, 30, { kb: 220 }, '#f2c230');
      else w.shoot(p, { speed: 780, r: 6, dmg: 13, kind: 'bolt', life: 0.9 });
    },
    ability(w, p) {
      if (p.form === 'hulkbuster') {
        w.fx.push({ k: 'ring', x: p.x, y: p.y, r: 160, c: '#ff9a3a', s: 'HulkSmashCrack' });
        w.aoeEnemies(p, p.x, p.y, 160, 40, { kb: 260, slow: 1.5 });
        return;
      }
      for (let i = 0; i < 5; i++) {
        w.shoot(p, { angle: p.aim + (i - 2) * 0.25, speed: 420, r: 6, dmg: 14, kind: 'missile', life: 1.8, homing: 4.5, metal: true, explodeR: 55 });
      }
    },
    ult(w, p) {
      const big = p.form === 'hulkbuster';
      w.fx.push({ k: 'beam', x: p.x, y: p.y, a: p.aim, len: 950, w: big ? 70 : 46, c: '#9fe8ff', s: 'IronManUniBeam' });
      w.lineEnemies(p, p.x, p.y, p.aim, 950, big ? 70 : 46, big ? 100 : 75, {});
    },
  },

  // ── Ghost Rider ── cadena de fuego; cada 15 bajas, Moto Infernal 8 s dejando fuego.
  ghostrider: {
    id: 'ghostrider', name: 'Ghost Rider', color: '#26262c', color2: '#ff8a1a', letter: 'G',
    hp: 125, speed: 225, crit: 0.08, abilityCd: 7, ultCd: 24,
    desc: 'El Espíritu de la Venganza. Látigo de cadena ardiente y una moto infernal.',
    kit: {
      attack: 'Cadena infernal: latigazo largo que quema',
      ability: 'Mirada de Penitencia: aturde y castiga al enemigo que miras',
      ult: 'Aliento del Infierno: cono de fuego que atraviesa',
      passive: 'Cada 15 bajas: Moto Infernal 8 s (+60% velocidad, deja un rastro de fuego). Fuego Azul de Zadkiel: llamas azules (+25% daño, quemaduras x2)',
    },
    init(w, p) { p.form = 'normal'; p.bikeKills = 0; p.bikeT = 0; p.trailT = 0; },
    modStats(p) {
      if (p.form === 'blue') p.dmgMult *= 1.25;
      if (p.bikeT > 0) p.speed *= 1.6;
    },
    onItem(w, p, it, id) {
      if (it.blueFire && p.form !== 'blue') {   // BlueSoulSkull.png (Fuego Azul de Zadkiel)
        p.form = 'blue';
        w.recalc(p);
        w.fx.push({ k: 'ring', x: p.x, y: p.y, r: 150, c: '#4fc8ff' });
        w.toast(`🔥 ${p.name}: ¡el Fuego Azul de Zadkiel arde en Ghost Rider!`, '#4fc8ff');
      }
    },
    onKill(w, p) {
      if (p.bikeT > 0) return;
      p.bikeKills++;
      if (p.bikeKills >= 15) {
        p.bikeKills = 0;
        p.bikeT = 8;
        w.recalc(p);
        w.fxText(p.x, p.y - 36, '¡MOTO INFERNAL!', '#ff8a1a');
        w.toast(`🏍 ${p.name} invoca su Moto Infernal`, '#ff8a1a');
      }
    },
    update(w, p, dt) {
      if (p.bikeT <= 0) return;
      p.bikeT -= dt;
      p.trailT -= dt;
      if (p.trailT <= 0) {
        p.trailT = 0.12;
        const blue = p.form === 'blue';
        w.spawnPlayerZone(p, p.x, p.y, { r: 34, dur: 2.5, dps: blue ? 30 : 18, color: blue ? '#4fc8ff' : '#ff7a1a' });
      }
      if (p.bikeT <= 0) { w.recalc(p); w.fxText(p.x, p.y - 36, 'La moto se desvanece', '#aaa'); }
    },
    attackRate: 0.42,
    attack(w, p) {
      const blue = p.form === 'blue';
      w.meleeArc(p, 118, 1.9, 15, { burn: true, burnDps: blue ? 12 : 6 }, blue ? '#4fc8ff' : '#ff8a1a');
    },
    ability(w, p) {
      const fx = p.x + Math.cos(p.aim) * 180, fy = p.y + Math.sin(p.aim) * 180;
      const t = w.nearestHostile(fx, fy, 300);
      if (!t) return false;
      w.fx.push({ k: 'bolt', x1: Math.round(p.x), y1: Math.round(p.y), x2: Math.round(t.x), y2: Math.round(t.y), c: p.form === 'blue' ? '#4fc8ff' : '#ff8a1a' });
      w.fxText(t.x, t.y - t.r - 18, '¡PENITENCIA!', '#ffb02e');
      w.hitEnemy(p, t, 45 + (t.boss ? 0 : t.maxHp * 0.25), { freeze: 2, burn: true, burnDps: 10 });
    },
    ult(w, p) {
      const blue = p.form === 'blue';
      for (let i = 0; i < 11; i++) {
        w.shoot(p, { angle: p.aim + (i - 5) * 0.09, speed: 520 + Math.random() * 120, r: 10, dmg: 16, kind: blue ? 'bluefire' : 'hellfire', life: 0.75, pierce: 3, o: { burn: true, burnDps: blue ? 14 : 8 } });
      }
    },
  },

  // ── Hulk ── al caer por 1ª vez pasa a Banner 2 minutos; si sobrevive, vuelve Hulk.
  hulk: {
    id: 'hulk', name: 'Hulk', color: '#4a9a2a', color2: '#6a2a8a', letter: 'H', r: 20,
    hp: 175, speed: 212, crit: 0.05, armor: 0.1, abilityCd: 6, ultCd: 24,
    desc: 'El más fuerte que existe. Pero si cae, Bruce Banner tendrá que aguantar 2 minutos.',
    kit: {
      attack: 'Puñetazo gamma (empuja) · Banner: pistola',
      ability: 'Salto gamma: cae aplastando la zona',
      ult: 'Palmada atronadora: onda de choque enorme',
      passive: 'Primera caída de la run: se convierte en Banner (débil) 120 s; si sobrevive, Hulk regresa con la vida al máximo',
    },
    init(w, p) { p.form = 'hulk'; p.bannerT = 0; p.bannerUsed = false; },
    modStats(p) {
      if (p.form === 'banner') { p.maxHp = Math.round(p.maxHp * 0.4); p.armor = 0; p.dmgMult *= 0.5; p.speed *= 0.97; }
    },
    onLethal(w, p) {
      if (p.form !== 'hulk' || p.bannerUsed) return false;
      p.bannerUsed = true;
      p.form = 'banner';
      p.bannerT = 120;
      p.r = 15;
      w.recalc(p);
      p.hp = p.maxHp;
      p.invulnT = 2.5;
      p.st = {};
      w.fx.push({ k: 'ring', x: p.x, y: p.y, r: 120, c: '#7a5aff' });
      w.toast(`${p.name}: Hulk cae... ¡Bruce Banner debe sobrevivir 2 minutos!`, '#b09aff');
      return true;
    },
    update(w, p, dt) {
      if (p.form !== 'banner') return;
      p.bannerT -= dt;
      if (p.bannerT <= 0) {
        p.form = 'hulk';
        p.r = 20;
        w.recalc(p);
        p.hp = p.maxHp;
        w.fx.push({ k: 'ring', x: p.x, y: p.y, r: 200, c: '#5fe03a' });
        w.toast(`💚 ${p.name}: ¡HULK HA VUELTO!`, '#5fe03a');
      }
    },
    attackRate(p) { return p.form === 'banner' ? 0.32 : 0.55; },
    attack(w, p) {
      if (p.form === 'banner') w.shoot(p, { speed: 700, r: 5, dmg: 9, kind: 'bolt', life: 0.9 });
      else w.meleeArc(p, 92, 2.0, 28, { kb: 220 }, '#7fe04a');
    },
    ability(w, p) {
      if (p.form === 'banner') return false;
      w.startDash(p, { mult: 3.4, dur: 0.28, noCd: true });
      w.schedule(0.28, () => {
        if (p.downed) return;
        w.fx.push({ k: 'ring', x: p.x, y: p.y, r: 140, c: '#7fe04a', s: 'HulkSmashCrack' });
        w.aoeEnemies(p, p.x, p.y, 140, 38, { kb: 240 });
      });
    },
    ult(w, p) {
      if (p.form === 'banner') { w.fxText(p.x, p.y - 34, 'Banner no puede...', '#b09aff'); return false; }
      w.fx.push({ k: 'ring', x: p.x, y: p.y, r: 270, c: '#7fe04a', s: 'HulkSmashCrack' });
      w.aoeEnemies(p, p.x, p.y, 270, 50, { kb: 320, slow: 2 });
    },
  },

  // ── Doctor Strange ── curación en área; con 2+ ítems místicos, además inmunidad.
  strange: {
    id: 'strange', name: 'Doctor Strange', color: '#1f3a7a', color2: '#e0402a', letter: 'D',
    hp: 105, speed: 220, crit: 0.06, attackRate: 0.3, abilityCd: 9, ultCd: 26,
    desc: 'Hechicero Supremo. Sana al equipo y controla el campo con magia.',
    kit: {
      attack: 'Proyectil místico (ligeramente teledirigido)',
      ability: 'Sello de Vishanti: cura 30% al equipo cercano (2+ ítems místicos: también inmunidad 2,5 s)',
      ult: 'Bandas Carmesí de Cyttorak: inmoviliza y daña a todo alrededor',
      passive: 'Ítems místicos: Capa de Levitación, Ojo de Agamotto, Anillo de Honda, Darkhold, Fuego de Zadkiel',
    },
    attack(w, p) { w.shoot(p, { speed: 650, r: 7, dmg: 12, kind: 'mystic', life: 1, homing: 2 }); },
    ability(w, p) {
      const immune = countTag(p.items, 'mystic') >= 2;
      let n = 0;
      for (const q of w.players.values()) {
        if (q.downed || q.astral || Math.hypot(q.x - p.x, q.y - p.y) > 170) continue;
        w.healPlayer(q, q.maxHp * 0.3);
        if (immune) q.invulnT = Math.max(q.invulnT, 2.5);
        w.fx.push({ k: 'ring', x: q.x, y: q.y, r: 40, c: '#ffb02e', s: 'SonicPulse' });
        n++;
      }
      w.fx.push({ k: 'ring', x: p.x, y: p.y, r: 170, c: immune ? '#ffe680' : '#ffb02e', s: 'SonicPulse' });
      w.fxText(p.x, p.y - 36, immune ? `Sello de Vishanti: ¡inmunidad! (${n})` : `Sello de Vishanti (${n})`, '#ffb02e');
    },
    ult(w, p) {
      w.fx.push({ k: 'ring', x: p.x, y: p.y, r: 300, c: '#e0402a', s: 'StrangeUlti' });
      w.aoeEnemies(p, p.x, p.y, 300, 30, { freeze: 3 });
    },
  },
};

const CHARS = Object.assign({}, BASE, HIDDEN);

function charMeta() {
  return Object.values(CHARS).map((c) => ({
    id: c.id, name: c.name, color: c.color, color2: c.color2, letter: c.letter,
    hidden: !!c.hidden, hp: c.hp, speed: c.speed, desc: c.desc, kit: c.kit,
    unlockHint: c.unlockHint || '', noUlt: !c.ult,
  }));
}

module.exports = { CHARS, charMeta, TAU };
