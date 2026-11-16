'use strict';
// Generación de pisos. Solo se usan los 4 jefes con sprite real (public/sprites_processed):
// Juggernaut, Ultrón, Magneto y Carnage. (Thanos, Dormammu, Loki y Galactus quedan fuera de
// la rotación: siguen definidos en bosses.js pero ningún piso los genera.)
//
//   Piso 1: 1 jefe · Piso 2: 1 jefe + sala de emboscada · Piso 3: 2 jefes a la vez ·
//   Piso 4 (final): 2 jefes a la vez + emboscada. Al vencerlo, victoria.
//
// El primer jefe de cada piso fija el BIOMA (fondo, colores, enemigos) de todas sus salas.
// Cada piso: 3 salas de combate en fila + arena; ramas opcionales (Tesoro, Bóveda, Desafío
// cronometrado) y la Sala Secreta oculta en un piso. Todas las conexiones son bidireccionales.
const RANDOM_BOSSES = ['juggernaut', 'ultron', 'magneto', 'carnage'];
const LAST_FLOOR = 4;

const BIOMES = {
  juggernaut: { name: 'Laboratorio A.I.M. destruido', stage: 'aim',      tint: 'rgba(40,20,10,0.18)', theme: '#2a2a2e', accent: '#d8a040',
                enemies: { grunt: 4, thief: 3, kamikaze: 3, aimlaser: 2, shooter: 1, brute: 1 } },
  ultron:     { name: 'Fortaleza Cibernética',        stage: 'futurist', tint: 'rgba(60,0,0,0.12)',   theme: '#1c1e24', accent: '#ff3a3a',
                enemies: { miniultron: 3, ninja: 3, kamikaze: 2, aimlaser: 2, thief: 1 } },
  magneto:    { name: 'Santuario de Genosha',         stage: 'magic',    tint: 'rgba(30,10,60,0.18)', theme: '#2a2e38', accent: '#b070ff',
                enemies: { grunt: 3, acolyte: 3, aimlaser: 2, ninja: 2, kamikaze: 1, brute: 1 } },
  carnage:    { name: 'Base Ravencroft',              stage: 'magic',    tint: 'rgba(110,0,0,0.22)',  theme: '#2b1b20', accent: '#d01818',
                enemies: { symbiote: 4, thief: 3, grunt: 2, ninja: 2, brute: 1 } },
};
// Variante de los pisos avanzados (más élite, más mezcla y fondo cósmico en el final).
const FLOOR_NAME = { 3: 'Convergencia', 4: 'Asalto Final' };

const ROOM_W = 1280, ROOM_H = 800;
const ARENA_W = 2000, ARENA_H = 1300;   // arenas de jefe grandes

const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function pickWeighted(map) {
  const entries = Object.entries(map);
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = Math.random() * total;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries[0][0];
}

// Sorteo de los jefes de toda la run: 1 · 1 · 2 · 2 (el final repite dos al azar).
function rollBossPlan() {
  const p = shuffle(RANDOM_BOSSES.slice());
  return { 1: [p[0]], 2: [p[1]], 3: [p[2], p[3]], 4: shuffle(RANDOM_BOSSES.slice()).slice(0, 2) };
}

// Definición del piso: bioma del primer jefe; los pisos 3–4 mezclan los enemigos de ambos jefes.
function floorDef(f, plan) {
  const bosses = plan[f];
  const B = BIOMES[bosses[0]];
  const enemies = Object.assign({}, B.enemies);
  if (bosses[1]) for (const [k, w] of Object.entries(BIOMES[bosses[1]].enemies)) enemies[k] = (enemies[k] || 0) + Math.ceil(w / 2);
  const def = Object.assign({}, B, { bosses, enemies, last: f === LAST_FLOOR });
  if (FLOOR_NAME[f]) def.name = `${FLOOR_NAME[f]}: ${B.name}`;
  if (f === LAST_FLOOR) { def.stage = 'cosmic'; def.tint = 'rgba(20,0,60,0.2)'; }
  return def;
}

function makeWaves(F, f, np, nWaves, elite) {
  const waves = [];
  const kinds = Object.keys(F.enemies);
  for (let i = 0; i < nWaves; i++) {
    const size = elite
      ? 2 + Math.floor(f / 2) + Math.floor((np - 1) * 0.8)
      : 3 + f + i + Math.floor((np - 1) * 1.5);
    const w = [];
    if (kinds.length > 1) {   // variedad: al menos 2 tipos por oleada
      const a = kinds[Math.floor(Math.random() * kinds.length)];
      const rest = kinds.filter((k) => k !== a);
      w.push(a, rest[Math.floor(Math.random() * rest.length)]);
    }
    while (w.length < size) w.push(pickWeighted(F.enemies));
    waves.push(w);
  }
  return waves;
}

function roomBase(F) { return { theme: F.theme, accent: F.accent, stage: F.stage, tint: F.tint }; }

function genFloor(f, np, hasSecret, plan) {
  const F = floorDef(f, plan);
  const main = [];
  for (let i = 0; i < 3; i++) {
    main.push(Object.assign(roomBase(F), {
      id: `m${i}`, type: 'combat', w: ROOM_W, h: ROOM_H,
      name: `${F.name} · Sala ${i + 1}`,
      waves: makeWaves(F, f, np, 2 + (f >= 3 ? 1 : 0) + (i === 2 ? 1 : 0), false),
    }));
  }
  // Emboscada sorpresa (piso 2+): las oleadas aparecen alrededor del equipo.
  if (f >= 2) { const a = main[rint(0, 2)]; a.ambush = true; a.waves.push(makeWaves(F, f, np, 1, true)[0]); }
  main.push(Object.assign(roomBase(F), {
    id: 'm3', type: 'boss', bosses: F.bosses, w: ARENA_W, h: ARENA_H,
    name: `${F.name} · ${F.bosses.length > 1 ? 'Arena de los jefes' : 'Arena del jefe'}`,
  }));

  const branches = {};
  const add = (i, k) => (branches[i] = branches[i] || []).push(k);
  add(rint(0, 2), 'treasure');
  if (Math.random() < 0.45) add(rint(0, 2), 'vault');
  if (Math.random() < 0.6) {   // desafío cronometrado (posible gema)
    const free = [0, 1, 2].filter((i) => !branches[i] || branches[i].length < 2);
    if (free.length) add(free[rint(0, free.length - 1)], 'challenge');
  }
  if (hasSecret) main[rint(0, 2)].secret = true;
  return { def: F, main, branches };
}

// Ramas: mantienen el fondo del bioma del piso; solo cambia el color del borde.
function branchSpec(kind, f, np, F, mainIndex) {
  const base = Object.assign(roomBase(F), { id: `b${mainIndex}${kind}` });
  if (kind === 'treasure') return Object.assign(base, { type: 'treasure', w: 900, h: 650, accent: '#d8b44a', name: 'Sala del Tesoro' });
  if (kind === 'vault') return Object.assign(base, { type: 'vault', w: 1100, h: 760, accent: '#5aa0ff', name: 'Bóveda del Coleccionista', waves: makeWaves(F, f, np, 2, true), elite: true });
  if (kind === 'challenge') return Object.assign(base, { type: 'challenge', w: 1100, h: 760, accent: '#ff5aa0', name: 'Desafío Cronometrado', waves: makeWaves(F, f + 1, np, 3, true), elite: true, timeLimit: 45 });
  if (kind === 'secret') return Object.assign(base, { type: 'secret', w: 1200, h: 800, accent: '#c070ff', name: 'Sala Secreta', waves: makeWaves(F, f + 1, np, 3, true), elite: true });
  return null;
}

// Salas conectadas a una sala (para puertas bidireccionales, minimapa y huida del Goblin).
function neighbors(floor, id) {
  const out = [];
  const m = /^m(\d)$/.exec(id);
  if (m) {
    const i = Number(m[1]);
    if (i > 0) out.push(`m${i - 1}`);
    if (i < floor.main.length - 1) out.push(`m${i + 1}`);
    for (const k of floor.branches[i] || []) out.push(`b${i}${k}`);
  } else {
    const b = /^b(\d)/.exec(id);
    if (b) out.push(`m${b[1]}`);
  }
  return out;
}

module.exports = { BIOMES, RANDOM_BOSSES, LAST_FLOOR, floorDef, rollBossPlan, genFloor, branchSpec, neighbors };
