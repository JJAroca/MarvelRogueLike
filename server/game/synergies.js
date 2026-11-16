'use strict';
// Sinergias cooperativas: bonificaciones pasivas automáticas para TODO el equipo cuando
// en la run (todos comparten sala) coinciden ciertos héroes. Se recalculan al empezar
// y cuando alguien se une o se desconecta.
//   mods: mismos campos que los ítems (dmg, ability, shield, speed, crit, lifesteal, atkSpeed, luck...)
//   burn: los golpes del equipo aplican quemadura.
//   shieldOnEnter: el escudo se rellena al entrar en cada sala ("escudo inicial").
const SYNERGIES = [
  { id: 'avengers',     name: 'Vengadores',      need: ['ironman', 'hulk'],         color: '#ff5a3a',
    desc: '+10% daño y escudo inicial (15% de la vida) en cada sala', mods: { dmg: 0.10, shield: 0.15 }, shieldOnEnter: true },
  { id: 'supernatural', name: 'Sobrenatural',    need: ['strange', 'ghostrider'],   color: '#ff9a1a',
    desc: '+15% daño de habilidades y los golpes queman', mods: { ability: 0.15 }, burn: true },
  { id: 'future',       name: 'Futuro Stark',    need: ['ironman', 'spider2099'],   color: '#e8283c',
    desc: '+12% velocidad, +8% crítico', mods: { speed: 0.12, crit: 0.08 } },
  { id: 'defenders',    name: 'Escudo y Martillo', need: ['cap', 'thor'],          color: '#6a8cff',
    desc: '+10% reducción de daño, +10% daño', mods: { armor: 0.10, dmg: 0.10 } },
  { id: 'xforce',       name: 'X-Force',         need: ['wolverine', 'venom'],      color: '#ffe14a',
    desc: '+6% robo de vida, +10% velocidad de ataque', mods: { lifesteal: 0.06, atkSpeed: 0.10 } },
  { id: 'chaos',        name: 'Caos y Engaño',   need: ['scarlet', 'loki'],         color: '#5fe08a',
    desc: '+12% daño, +10% probabilidad de ítems raros', mods: { dmg: 0.12, luck: 0.10 } },
];
const BY_ID = Object.fromEntries(SYNERGIES.map((s) => [s.id, s]));

// charIds: iterable de personajes del equipo → ids de sinergias activas.
function activeSynergies(charIds) {
  const set = new Set(charIds);
  return SYNERGIES.filter((s) => s.need.every((c) => set.has(c))).map((s) => s.id);
}

function synergyMeta() {
  return SYNERGIES.map((s) => ({ id: s.id, name: s.name, need: s.need, desc: s.desc, color: s.color }));
}

module.exports = { SYNERGIES, BY_ID, activeSynergies, synergyMeta };
