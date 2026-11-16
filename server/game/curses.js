'use strict';
// Sobrecarga Cósmica: cuantas más Gemas del Infinito tiene el equipo, más probable es que al
// entrar en combate una de ellas se desestabilice durante 10 s (15% por gema, máx. 90%).
// Con las 6 gemas se activa el Poder del Guantelete y las maldiciones cesan.
const DURATION = 10;
const CHANCE_PER_GEM = 0.15;

const CURSES = {
  espacio:  { name: 'Inestabilidad del Espacio', desc: 'Teletransportes aleatorios por la arena' },
  poder:    { name: 'Sobrecarga de Poder',       desc: 'Todos infligen y reciben +50% de daño' },
  tiempo:   { name: 'Distorsión Temporal',       desc: 'Héroes −30% velocidad, enemigos más rápidos' },
  realidad: { name: 'Realidad Fracturada',       desc: 'Ilusiones de enemigos y proyectiles que rebotan' },
  alma:     { name: 'Hambre del Alma',           desc: 'Pierdes un 2% de vida por segundo hasta conseguir una baja' },
  mente:    { name: 'Interferencia Mental',      desc: 'Minimapa bloqueado e interferencias' },
};

const pick = (a) => a[Math.floor(Math.random() * a.length)];

function roll(w) {
  if (w.gauntlet || w.curse || !w.gems.size) return false;
  if (Math.random() >= Math.min(0.9, CHANCE_PER_GEM * w.gems.size)) return false;
  start(w, pick([...w.gems]));
  return true;
}

function start(w, g) {
  w.curse = { g, t: DURATION, tick: 0.6 };
  const C = CURSES[g];
  w.toast(`☄ SOBRECARGA CÓSMICA — ${C.name}: ${C.desc} (10 s)`, require('./gems').GEMS[g].color);
  for (const p of w.players.values()) {
    w.fx.push({ k: 'ring', x: Math.round(p.x), y: Math.round(p.y), r: 120, c: require('./gems').GEMS[g].color });
    if (g === 'alma') p.soulDrain = true;
  }
  if (g === 'realidad') {
    // Ilusiones: copias de enemigos normales que mueren de un golpe y desaparecen al acabar.
    const base = w.enemies.filter((e) => !e.dead && !e.boss && !e.ally && !e.illusion);
    const types = base.length ? base.map((e) => e.type) : Object.keys(w.floorDef.enemies);
    for (let i = 0; i < 3 + w.players.size; i++) {
      const pos = w.freeSpot(220);
      w.spawnEnemy(pick(types), pos.x, pos.y, { illusion: true });
    }
  }
}

function update(w, dt) {
  const c = w.curse;
  if (!c) return;
  c.t -= dt;
  c.tick -= dt;
  if (c.g === 'espacio' && c.tick <= 0) {
    c.tick = 2.5;
    for (const p of w.alivePlayers()) {
      w.fx.push({ k: 'ring', x: Math.round(p.x), y: Math.round(p.y), r: 50, c: '#3d7bff' });
      const pos = w.freeSpot(0);
      p.x = pos.x; p.y = pos.y; p.dashT = 0;
      w.fx.push({ k: 'ring', x: Math.round(p.x), y: Math.round(p.y), r: 50, c: '#3d7bff', s: 'VoidPortal' });
    }
  }
  if (c.g === 'alma') {
    for (const p of w.players.values()) {
      if (p.soulDrain && !p.downed && !p.astral) w.hurtPlayer(p, p.maxHp * 0.02 * dt, { dot: true });
    }
  }
  if (c.t <= 0) end(w);
}

function end(w) {
  const c = w.curse;
  if (!c) return;
  if (c.g === 'realidad') for (const e of w.enemies) if (e.illusion && !e.dead) w.killEnemy(e, null, true);
  for (const p of w.players.values()) p.soulDrain = false;
  w.curse = null;
}

// Modificadores consultados por la simulación.
const dmgMult = (w) => (w.curse && w.curse.g === 'poder' ? 1.5 : 1);
const playerSpeed = (w) => (w.curse && w.curse.g === 'tiempo' ? 0.7 : 1);
const enemySpeed = (w) => (w.curse && w.curse.g === 'tiempo' ? 1.3 : 1);
const bounce = (w) => !!(w.curse && w.curse.g === 'realidad');

module.exports = { CURSES, DURATION, roll, start, update, end, dmgMult, playerSpeed, enemySpeed, bounce };
