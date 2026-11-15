'use strict';
// Tienda de mejoras permanentes del lobby (se paga con fragmentos Iso-8).
const UPGRADES = {
  hp:    { name: 'Vida máxima',            desc: '+8% de vida máxima por nivel',            per: 0.08, max: 10, base: 40 },
  dmg:   { name: 'Daño base',              desc: '+6% de daño por nivel',                   per: 0.06, max: 10, base: 50 },
  speed: { name: 'Velocidad de movimiento', desc: '+3% de velocidad por nivel',              per: 0.03, max: 8,  base: 45 },
  rare:  { name: 'Prob. de ítems raros',    desc: '+3% de probabilidad de rareza alta en cofres', per: 0.03, max: 8, base: 60 },
};

function cost(stat, lvl) {
  return Math.round(UPGRADES[stat].base * Math.pow(1.5, lvl));
}

function buy(profile, stat) {
  const u = UPGRADES[stat];
  if (!u) return { ok: false, msg: 'Mejora desconocida' };
  const lvl = profile.upgrades[stat] || 0;
  if (lvl >= u.max) return { ok: false, msg: 'Ya está al nivel máximo' };
  const c = cost(stat, lvl);
  if (profile.iso8 < c) return { ok: false, msg: `Necesitas ${c} Iso-8` };
  profile.iso8 -= c;
  profile.upgrades[stat] = lvl + 1;
  return { ok: true, msg: `${u.name} → nivel ${lvl + 1}` };
}

// Multiplicadores que aplica el mundo al crear al jugador.
function bonuses(profile) {
  const u = profile.upgrades;
  return {
    hp: 1 + UPGRADES.hp.per * (u.hp || 0),
    dmg: 1 + UPGRADES.dmg.per * (u.dmg || 0),
    speed: 1 + UPGRADES.speed.per * (u.speed || 0),
    rare: UPGRADES.rare.per * (u.rare || 0),
  };
}

function catalog(profile) {
  return Object.entries(UPGRADES).map(([id, u]) => {
    const lvl = profile.upgrades[id] || 0;
    return { id, name: u.name, desc: u.desc, level: lvl, max: u.max, cost: lvl >= u.max ? null : cost(id, lvl) };
  });
}

module.exports = { UPGRADES, buy, bonuses, catalog };
