'use strict';
// ══════════ EXPANSIÓN: personajes desbloqueables ══════════
// Héroes clásicos (antes iniciales) + ocultos. Spider-Man clásico se retiró del roster:
// su lugar lo ocupa Spider-Man 2099 (sprites reales y efectos 8-bit). Se desbloquean de forma permanente
// en el perfil (ver server/unlocks.js).
const TAU = Math.PI * 2;

module.exports = {
  cap: {
    id: 'cap', hidden: true, name: 'Capitán América', color: '#2a4ad4', color2: '#e8e8f0', letter: 'C',
    hp: 140, speed: 218, crit: 0.05, attackRate: 0.38, abilityCd: 3.5, ultCd: 25,
    desc: 'Líder resistente. Golpes cuerpo a cuerpo y escudo bumerán (metálico).',
    kit: { attack: 'Puñetazo (empuja)', ability: 'Lanzamiento de escudo: atraviesa y vuelve', ult: '¡Vengadores, unidos!: +30% daño y +25% defensa al equipo', passive: 'Supersoldado: vida alta' },
    unlockHint: 'Reanima a un aliado caído (mantén F 10 s), o derrota a Carnage o a Ultrón.',
    attack(w, p) { w.meleeArc(p, 72, 1.9, 18, { kb: 140 }, '#d6dcf0'); },
    ability(w, p) { w.shoot(p, { speed: 680, r: 12, dmg: 20, kind: 'shield', life: 2.2, pierce: Infinity, boomerang: 0.42, metal: true }); },
    ult(w, p) {
      for (const q of w.players.values()) {
        if (q.downed || q.astral) continue;
        q.buffs.avengers = 7;
        w.healPlayer(q, q.maxHp * 0.15);
        w.fx.push({ k: 'ring', x: q.x, y: q.y, r: 70, c: '#6a8cff' });
      }
      w.toast(`${p.name}: ¡Vengadores, unidos!`, '#6a8cff');
    },
  },

  // ── Thor ──
  thor: {
    id: 'thor', hidden: true, name: 'Thor', color: '#8a96a8', color2: '#c0262d', letter: 'T',
    hp: 130, speed: 208, crit: 0.05, attackRate: 0.5, abilityCd: 6, ultCd: 26,
    desc: 'Dios del Trueno. Martillazos devastadores y rayos encadenados.',
    kit: { attack: 'Golpe de Mjolnir', ability: 'Rayo en cadena (5 objetivos)', ult: 'Tormenta divina: 14 rayos sobre los enemigos', passive: 'Digno: golpes que empujan' },
    unlockHint: 'Derrota a una pareja de jefes dobles (pisos 3 y 4).',
    attack(w, p) { w.meleeArc(p, 84, 1.7, 22, { kb: 160 }, '#9fd0ff'); },
    ability(w, p) {
      let from = p;
      const hit = new Set();
      for (let k = 0; k < 5; k++) {
        const t = w.nearestHostile(from.x, from.y, k === 0 ? 420 : 240, hit);
        if (!t) break;
        w.fx.push({ k: 'bolt', x1: Math.round(from.x), y1: Math.round(from.y), x2: Math.round(t.x), y2: Math.round(t.y), c: '#bfe6ff' });
        w.hitEnemy(p, t, 22, {});
        hit.add(t.id);
        from = t;
      }
    },
    ult(w, p) {
      w.toast(`${p.name}: ¡Por Asgard!`, '#9fd0ff');
      for (let i = 0; i < 14; i++) {
        w.schedule(i * 0.25, () => {
          const t = w.randomHostile();
          const x = t ? t.x : p.x + (Math.random() - 0.5) * 500;
          const y = t ? t.y : p.y + (Math.random() - 0.5) * 500;
          w.fx.push({ k: 'bolt', x1: Math.round(x), y1: Math.round(y - 400), x2: Math.round(x), y2: Math.round(y), c: '#dff2ff' });
          w.fx.push({ k: 'boom', x: Math.round(x), y: Math.round(y), r: 70, c: '#9fd0ff' });
          w.aoeEnemies(p, x, y, 70, 34, {});
        });
      }
    },
  },

  // ── Venom ── Shift alterna Modo Tanque / Modo Sigilo.
  venom: {
    id: 'venom', hidden: true, name: 'Venom', color: '#15151c', color2: '#f2f2f2', letter: 'V',
    hp: 165, speed: 228, crit: 0.05, abilityCd: 0.6, fixedAbilityCd: true, ultCd: 22,
    desc: 'Simbionte de dos caras: tanque que se cura mordiendo, o cazador invisible.',
    kit: {
      attack: 'Tanque: mordisco en área con robo de vida · Sigilo: zarcillos de crítico alto',
      ability: '[Shift] Alternar Modo Tanque (lento, +30% defensa) / Modo Sigilo (rápido)',
      ult: '¡Somos Venom!: devora todo alrededor y se cura',
      passive: 'En Modo Sigilo el dash te vuelve invisible 1,8 s',
    },
    unlockHint: 'Sobrevive a una sala con menos del 10% de vida, o reúne 3 ítems oscuros/simbionte en una misma run.',
    init(w, p) { p.mode = 'tank'; },
    modStats(p) {
      if (p.mode === 'tank') { p.speed *= 0.75; p.armor += 0.3; }
      else p.speed *= 1.3;
    },
    attackRate(p) { return p.mode === 'tank' ? 0.45 : 0.24; },
    attack(w, p) {
      if (p.mode === 'tank') w.meleeArc(p, 88, 2.3, 24, { lifesteal: 0.25, kb: 120 }, '#e8e8f0');
      else w.shoot(p, { speed: 900, r: 6, dmg: 11, kind: 'tendril', life: 0.7, pierce: 1, o: { critBonus: 0.4, critMult: 2.2 } });
    },
    ability(w, p) {
      p.mode = p.mode === 'tank' ? 'stealth' : 'tank';
      w.recalc(p);
      w.fxText(p.x, p.y - 34, p.mode === 'tank' ? 'MODO TANQUE' : 'MODO SIGILO', '#e8e8f0');
      w.fx.push({ k: 'ring', x: p.x, y: p.y, r: 60, c: '#9a9aa8' });
    },
    onDash(w, p) { if (p.mode === 'stealth') p.invisT = Math.max(p.invisT, 1.8); },
    ult(w, p) {
      w.fx.push({ k: 'ring', x: p.x, y: p.y, r: 230, c: '#e8e8f0' });
      w.aoeEnemies(p, p.x, p.y, 230, 55, { lifesteal: 0.35 });
    },
  },

  // ── Wolverine ── Sin ulti activa. Regeneración pasiva + Berserker al bajar del 40%.
  wolverine: {
    id: 'wolverine', hidden: true, name: 'Wolverine', color: '#f2c81a', color2: '#2a4aa8', letter: 'W',
    hp: 150, speed: 225, crit: 0.12, regen: 0.015, attackRate: 0.3, abilityCd: 4, ultCd: 0,
    desc: 'Garras de adamantium y un factor curativo que nunca se detiene.',
    kit: {
      attack: 'Garras (sangrado en Berserker)',
      ability: 'Embestida: salta hacia delante y desgarra en área',
      ult: 'SIN ULTI — Pasiva: Modo Berserker por debajo del 40% de vida',
      passive: 'Regeneración constante (1,5% vida/s). Berserker: x2,2 vel. ataque, x1,5 movimiento, sangrado',
    },
    unlockHint: 'Recibe 500 o más de daño acumulado en una sola run sin morir (sin ser derribado).',
    modStats(p) {
      if (p.berserk) { p.atkSpeed *= 2.2; p.speed *= 1.5; }
    },
    update(w, p) {
      const b = p.hp / p.maxHp < 0.4;
      if (b !== p.berserk) {
        p.berserk = b;
        w.recalc(p);
        if (b) { w.fxText(p.x, p.y - 34, '¡BERSERKER!', '#ff4040'); w.fx.push({ k: 'ring', x: p.x, y: p.y, r: 90, c: '#ff3030' }); }
      }
    },
    attack(w, p) { w.meleeArc(p, 64, 1.8, 13, { bleed: p.berserk, bleedDps: 7 }, p.berserk ? '#ff5050' : '#ffe14a'); },
    ability(w, p) {
      w.startDash(p, { mult: 3.6, dur: 0.2, noCd: true });
      w.schedule(0.2, () => {
        if (p.downed) return;
        w.fx.push({ k: 'ring', x: p.x, y: p.y, r: 95, c: '#ffe14a' });
        w.aoeEnemies(p, p.x, p.y, 95, 26, { bleed: true, bleedDps: 7 });
      });
    },
    ult: null,
  },

  // ── Spider-Man 2099 ── Garras láser, ulti de telarañas congelantes y auto-revivir 1 vez.
  spider2099: {
    id: 'spider2099', hidden: true, name: 'Spider-Man 2099', color: '#1b2a6b', color2: '#e8283c', letter: '2',
    hp: 110, speed: 245, crit: 0.1, attackRate: 0.24, abilityCd: 4, ultCd: 22,
    desc: 'Miguel O\'Hara, del año 2099. Garras láser y tecnología temporal.',
    kit: {
      attack: 'Garras láser (sangrado)',
      ability: 'Balanceo: dash largo e invulnerable',
      ult: 'Red criogénica: 16 telarañas que congelan 3 s',
      passive: 'Dispositivo Temporal: te revive automáticamente 1 vez por partida',
    },
    unlockHint: 'Derrota a Magneto o a Juggernaut, o limpia un piso en menos de 2 minutos sin recibir daño.',
    attack(w, p) { w.meleeArc(p, 72, 1.6, 13, { bleed: true, bleedDps: 6 }, '#ff3a6a'); },
    ability(w, p) { w.startDash(p, { mult: 3.8, dur: 0.3, noCd: true }); },
    ult(w, p) {
      for (let i = 0; i < 16; i++) {
        w.shoot(p, { angle: (i / 16) * TAU, speed: 520, r: 8, dmg: 10, kind: 'web2099', life: 0.9, pierce: 2, o: { freeze: 3 } });
      }
      w.aoeEnemies(p, p.x, p.y, 140, 10, { freeze: 2 });
      w.fx.push({ k: 'ring', x: p.x, y: p.y, r: 140, c: '#6fd8ff' });
    },
    onLethal(w, p) {
      if (p.usedRevive) return false;
      p.usedRevive = true;
      p.hp = p.maxHp * 0.5;
      p.invulnT = 2.5;
      p.st = {};
      w.fx.push({ k: 'ring', x: p.x, y: p.y, r: 200, c: '#6fd8ff' });
      w.aoeEnemies(p, p.x, p.y, 200, 20, { freeze: 2 });
      w.toast(`⏱ ${p.name}: ¡Dispositivo Temporal activado! (revivir usado)`, '#6fd8ff');
      return true;
    },
  },

  // ── Bruja Escarlata ── Magia del Caos (estados aleatorios) y ulti que convierte enemigos en aliados.
  scarlet: {
    id: 'scarlet', hidden: true, name: 'Bruja Escarlata', color: '#c0143c', color2: '#ff6fa0', letter: 'B',
    hp: 95, speed: 215, crit: 0.05, attackRate: 0.32, abilityCd: 5, ultCd: 28,
    desc: 'Wanda Maximoff. La Magia del Caos reescribe la realidad del combate.',
    kit: {
      attack: 'Rayo del Caos: aplica un estado aleatorio (quemadura, congelación, lentitud, veneno, confusión, debilidad)',
      ability: 'Salto caótico: se teletransporta hacia el cursor y estalla en ambos puntos',
      ult: 'Hex Mayor: los enemigos normales cercanos se vuelven aliados durante 10 s',
      passive: 'Los aliados convertidos luchan por ti y se desvanecen al terminar',
    },
    unlockHint: 'Reúne 2 o más Gemas del Infinito en una misma run.',
    attack(w, p) { w.shoot(p, { speed: 600, r: 8, dmg: 13, kind: 'chaos', life: 1, o: { chaos: true } }); },
    ability(w, p) {
      const dist = Math.min(320, Math.hypot(p.input.ax - p.x, p.input.ay - p.y));
      const ox = p.x, oy = p.y;
      w.aoeEnemies(p, ox, oy, 90, 18, { chaos: true });
      w.fx.push({ k: 'boom', x: ox, y: oy, r: 90, c: '#ff4fa0' });
      p.x += Math.cos(p.aim) * dist;
      p.y += Math.sin(p.aim) * dist;
      w.clampToRoom(p);
      p.invulnT = Math.max(p.invulnT, 0.3);
      w.aoeEnemies(p, p.x, p.y, 90, 18, { chaos: true });
      w.fx.push({ k: 'boom', x: p.x, y: p.y, r: 90, c: '#ff4fa0' });
    },
    ult(w, p) {
      let n = 0;
      for (const e of w.enemies) {
        if (e.dead || e.ally || e.boss || e.clone || e.spawning > 0) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) > 360) continue;
        e.ally = true;
        e.allyT = 10;
        e.hp = e.maxHp;
        e.st = {};
        n++;
      }
      w.fx.push({ k: 'ring', x: p.x, y: p.y, r: 360, c: '#ff2f6f' });
      w.toast(`${p.name}: ¡Hex Mayor! ${n} enemigo(s) ahora luchan a vuestro lado`, '#ff4fa0');
    },
  },

  // ── Loki ── Suerte en cofres y un dash que deja un clon ilusorio explosivo.
  loki: {
    id: 'loki', hidden: true, name: 'Loki', color: '#1f7a3a', color2: '#d8b44a', letter: 'L',
    hp: 105, speed: 232, crit: 0.08, luck: 0.15, extraChest: true, attackRate: 0.34, abilityCd: 9, ultCd: 24,
    desc: 'El Dios del Engaño. Nada es lo que parece... sobre todo él.',
    kit: {
      attack: 'Dagas: abanico de 3',
      ability: 'Invisibilidad durante 3 s (los enemigos te pierden)',
      ult: 'Rey de las Mentiras: 3 clones que atraen enemigos y explotan',
      passive: 'Suerte aumentada en cofres (+15% rareza y +1 ítem). El dash deja un clon explosivo',
    },
    unlockHint: 'Encuentra la Sala Secreta (una ilusión oculta en algún piso) y supera su desafío.',
    attack(w, p) {
      for (let i = -1; i <= 1; i++) w.shoot(p, { angle: p.aim + i * 0.18, speed: 750, r: 5, dmg: 8, kind: 'dagger', life: 0.7 });
    },
    ability(w, p) {
      p.invisT = 3;
      w.fx.push({ k: 'boom', x: p.x, y: p.y, r: 50, c: '#5fe08a' });
    },
    onDash(w, p, sx, sy) { w.spawnDecoy(p, sx, sy, 1.6, 35, 110); },
    ult(w, p) {
      for (let i = 0; i < 3; i++) {
        const a = p.aim + (i / 3) * TAU;
        w.spawnDecoy(p, p.x + Math.cos(a) * 120, p.y + Math.sin(a) * 120, 3, 45, 130);
      }
      w.fx.push({ k: 'ring', x: p.x, y: p.y, r: 140, c: '#5fe08a' });
    },
  },
};
