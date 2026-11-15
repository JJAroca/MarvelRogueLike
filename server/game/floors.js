'use strict';
// Generación de pisos: 3 salas de combate + arena de jefe, con ramas opcionales
// (Tesoro, Bóveda con gema) y una Sala Secreta del Engaño oculta en algún piso.
//
// JEFES ALEATORIOS POR BIOMA: al empezar la run se sortean los jefes de los pisos 1 y 2
// entre Juggernaut, Ultrón, Magneto y Carnage (sin repetir). El jefe elegido fija el
// BIOMA de todo el piso: nombre, fondo (stage de public/sprites_processed/stage/), colores
// y enemigos de las oleadas. Todas las salas del piso (combate, tesoro, bóveda, secreta y
// arena) comparten ese fondo: no cambia al avanzar de sala.
const RANDOM_BOSSES = ['juggernaut', 'ultron', 'magneto', 'carnage'];

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

// Pisos fijos (3–5).
const FIXED = {
  3: { name: 'Dimensión Oscura',   boss: 'dormammu', stage: 'magic',  tint: 'rgba(120,40,0,0.25)', theme: '#1d1530', accent: '#ff7a1a', enemies: { mystic: 3, symbiote: 2, ninja: 2, mindless: 1, thief: 1 } },
  4: { name: 'El Santuario',       boss: 'thanos',   stage: 'cosmic', tint: 'rgba(0,0,0,0.25)',    theme: '#18202e', accent: '#c9a23a', enemies: { outrider: 4, aimlaser: 2, brute: 2, mystic: 2, miniultron: 1, ninja: 1 } },
  5: { name: 'Borde del Universo', boss: 'galactus', stage: 'cosmic', tint: 'rgba(20,0,60,0.2)',   theme: '#0a0a18', accent: '#8a7aff', enemies: {} },
};
// Gema que suelta el jefe de cada piso (los jefes de 1–2 son aleatorios).
const FLOOR_GEM = { 1: 'poder', 2: 'alma', 3: 'tiempo' };

const ROOM_W = 1280, ROOM_H = 800;
const ARENA_W = 2000, ARENA_H = 1300;   // arenas de jefe grandes

const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function pickWeighted(map) {
  const entries = Object.entries(map);
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = Math.random() * total;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries[0][0];
}

// Sorteo de jefes de la run (pisos 1 y 2, sin repetir).
function rollBossPlan() {
  const pool = RANDOM_BOSSES.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return { 1: pool[0], 2: pool[1] };
}

// Definición del piso: bioma del jefe sorteado (1–2) o piso fijo (3–5).
function floorDef(f, plan) {
  if (FIXED[f]) return Object.assign({ gem: FLOOR_GEM[f] || null }, FIXED[f]);
  const boss = plan[f];
  return Object.assign({ boss, gem: FLOOR_GEM[f] }, BIOMES[boss]);
}

function makeWaves(F, f, np, nWaves, elite) {
  const waves = [];
  const kinds = Object.keys(F.enemies);
  for (let i = 0; i < nWaves; i++) {
    const size = elite
      ? 2 + Math.floor(f / 2) + Math.floor((np - 1) * 0.8)
      : 3 + f + i + Math.floor((np - 1) * 1.5);
    const w = [];
    // Variedad: cada oleada incluye al menos 2 tipos distintos del bioma.
    if (kinds.length > 1) {
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
  if (f === 5) {
    return {
      def: F,
      main: [Object.assign(roomBase(F), { type: 'boss', boss: 'galactus', w: 2300, h: 1500, name: 'Galactus, el Devorador de Mundos' })],
      branches: {},
    };
  }
  const main = [];
  for (let i = 0; i < 3; i++) {
    main.push(Object.assign(roomBase(F), {
      type: 'combat', w: ROOM_W, h: ROOM_H,
      name: `${F.name} · Sala ${i + 1}`,
      waves: makeWaves(F, f, np, 2 + (f >= 3 ? 1 : 0) + (i === 2 ? 1 : 0), false),
    }));
  }
  main.push(Object.assign(roomBase(F), { type: 'boss', boss: F.boss, gem: F.gem, w: ARENA_W, h: ARENA_H, name: `${F.name} · Arena del jefe` }));

  const branches = {};
  branches[rint(0, 2)] = ['treasure'];
  if (Math.random() < 0.6) {
    const v = rint(0, 2);
    (branches[v] = branches[v] || []).push('vault');
  }
  if (hasSecret) main[rint(0, 2)].secret = true;
  return { def: F, main, branches };
}

// Ramas: mantienen el fondo del bioma del piso; solo cambia el color del borde.
function branchSpec(kind, f, np, F) {
  const base = roomBase(F);
  if (kind === 'treasure') return Object.assign(base, { type: 'treasure', w: 900, h: 650, accent: '#d8b44a', name: 'Sala del Tesoro' });
  if (kind === 'vault') return Object.assign(base, { type: 'vault', w: 1100, h: 760, accent: '#5aa0ff', name: 'Bóveda del Coleccionista', waves: makeWaves(F, f, np, 2, true), elite: true });
  if (kind === 'secret') return Object.assign(base, { type: 'secret', boss: 'loki', w: 1700, h: 1150, accent: '#5fe08a', name: 'Sala Secreta del Engaño' });
  return null;
}

module.exports = { BIOMES, RANDOM_BOSSES, floorDef, rollBossPlan, genFloor, branchSpec };
