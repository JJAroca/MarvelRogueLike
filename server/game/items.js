'use strict';
// Ítems pasivos.
//
// El NOMBRE DEL ARCHIVO del icono es el id del ítem: al arrancar se leen los PNG de
// public/sprites_processed/items/ (generados desde sprites/items/ por process_sprites.py)
// y cada archivo se busca en ITEM_TABLE. Si aparece un PNG nuevo que no está en la tabla,
// sus estadísticas se deducen de palabras clave del nombre (Boots → velocidad, Sword → daño...).
//
//   tags 'symbiote' / 'dark' → cuentan para desbloquear a Venom
//   tag  'armor'             → Iron Man evoluciona a Hulk-Buster con 3 o más
//   tag  'mystic'            → Doctor Strange: con 2 o más su sello da inmunidad
//   blueFire                 → Ghost Rider pasa a Fuego Azul (Calavera de Zadkiel)
//
// mods (todos sumativos): hp, dmg, speed, armor, crit, lifesteal, regen, atkSpeed, cd, dashCd,
//   shield (escudo = % de vida máx.), melee (daño cuerpo a cuerpo), ability (daño de habilidad/ulti), luck
// active: efecto periódico propio del ítem (granada gamma, dron espía).
// aura: color del aura sutil que se dibuja en el personaje mientras el ítem está activo.
const fs = require('fs');
const path = require('path');

const ITEM_TABLE = {
  // ── Comunes ──
  JetBoots:          { name: 'Botas Jet',                  rarity: 'common', desc: '+10% velocidad, -25% enfriamiento del dash', mods: { speed: 0.10, dashCd: 0.25 }, aura: '#ff9a3a' },
  SuperSoldierSerum: { name: 'Suero del Supersoldado',     rarity: 'common', desc: '+20% vida máxima y curación total', mods: { hp: 0.20 }, onPick: 'healFull', aura: '#6fd8ff' },
  MiniArcCore:       { name: 'Mini Núcleo Arc',            rarity: 'common', tags: ['armor'], desc: '-15% enfriamientos (armadura)', mods: { cd: 0.15 } },
  TechScrap:         { name: 'Chatarra Stark',             rarity: 'common', tags: ['armor'], desc: '+5% reducción de daño, +8% vida (armadura)', mods: { armor: 0.05, hp: 0.08 } },
  PlasmaBlaster:     { name: 'Bláster de Plasma',          rarity: 'common', desc: '+10% daño, +10% velocidad de ataque', mods: { dmg: 0.10, atkSpeed: 0.10 } },
  UtilityBelt:       { name: 'Cinturón Multiusos',         rarity: 'common', desc: 'Cura total y +0,4% regeneración/s', mods: { regen: 0.004 }, onPick: 'healFull', aura: '#7fff9a' },
  // ── Raros ──
  ArcReactorShield:  { name: 'Escudo de Reactor Arc',      rarity: 'rare', tags: ['armor'], desc: 'Escudo de energía (25% de la vida) que se recarga si no recibes daño (armadura)', mods: { shield: 0.25 }, aura: '#4fd8ff' },
  AsgardianArmor:    { name: 'Armadura Asgardiana',        rarity: 'rare', tags: ['armor'], desc: '+12% reducción de daño (armadura)', mods: { armor: 0.12 }, aura: '#ffd76a' },
  AdamantiumClawRight: { name: 'Garra de Adamantium (D)',  rarity: 'rare', desc: '+25% daño cuerpo a cuerpo', mods: { melee: 0.25 } },
  AdamantiumClawLeft:  { name: 'Garra de Adamantium (I)',  rarity: 'rare', desc: '+12% daño cuerpo a cuerpo, +8% crítico', mods: { melee: 0.12, crit: 0.08 } },
  CyclopsVisor:      { name: 'Visor de Cíclope',           rarity: 'rare', desc: '+12% probabilidad de crítico', mods: { crit: 0.12 } },
  MechanicalGears:   { name: 'Engranajes Pym',             rarity: 'rare', desc: '+15% velocidad de ataque', mods: { atkSpeed: 0.15 } },
  ShieldKeycard:     { name: 'Tarjeta de S.H.I.E.L.D.',    rarity: 'rare', desc: '+6% probabilidad de ítems raros, +6% daño', mods: { luck: 0.06, dmg: 0.06 } },
  SpyDrone:          { name: 'Dron Espía',                 rarity: 'rare', desc: 'Un dron te acompaña y dispara al enemigo más cercano', mods: {}, active: 'drone', aura: '#9fe8ff' },
  ToxicBarrel:       { name: 'Barril Tóxico',              rarity: 'rare', desc: 'Tus golpes tienen 25% de prob. de envenenar', mods: {}, poison: 0.25, aura: '#7dff4a' },
  AstralMirror:      { name: 'Espejo Astral',              rarity: 'rare', tags: ['mystic'], desc: '+15% daño de habilidad, -10% enfriamientos (místico)', mods: { ability: 0.15, cd: 0.10 } },
  AlienForaPod:      { name: 'Vaina Simbionte',            rarity: 'rare', tags: ['symbiote', 'dark'], desc: '+20% vida máxima, +4% robo de vida', mods: { hp: 0.20, lifesteal: 0.04 } },
  DarkEnergySword:   { name: 'Espada de Energía Oscura',   rarity: 'rare', tags: ['dark'], desc: '+18% daño, +4% robo de vida', mods: { dmg: 0.18, lifesteal: 0.04 }, aura: '#b05cff' },
  DarkholdTome:      { name: 'Tomo del Darkhold',          rarity: 'rare', tags: ['dark', 'mystic'], desc: '+25% daño, -10% vida máxima (místico)', mods: { dmg: 0.25, hp: -0.10 }, aura: '#c01818' },
  // ── Épicos ──
  Iso8Crystal:       { name: 'Cristal Iso-8',              rarity: 'epic', desc: '+30% daño de habilidad/ulti, +8% crítico', mods: { ability: 0.30, crit: 0.08 }, aura: '#d27bff' },
  GammaGrenade:      { name: 'Granada Gamma',              rarity: 'epic', desc: 'Cada 5 s lanza una granada gamma (daño en área)', mods: {}, active: 'grenade', aura: '#7fe04a' },
  AsgardianBlade:    { name: 'Hoja Asgardiana',            rarity: 'epic', desc: '+20% daño, +5% crítico', mods: { dmg: 0.20, crit: 0.05 } },
  CloakOfLevitation: { name: 'Capa de Levitación',         rarity: 'epic', tags: ['mystic'], desc: '-30% enfriamiento de dash, +6% velocidad (místico)', mods: { dashCd: 0.30, speed: 0.06 }, aura: '#ff4a4a' },
  EyeOfAgamotto:     { name: 'Ojo de Agamotto',            rarity: 'epic', tags: ['mystic'], desc: '-15% enfriamientos, +0,4% regeneración/s (místico)', mods: { cd: 0.15, regen: 0.004 }, aura: '#2ee86b' },
  VoidPotion:        { name: 'Poción del Vacío',           rarity: 'epic', tags: ['dark'], desc: '+15% velocidad de ataque, +10% daño', mods: { atkSpeed: 0.15, dmg: 0.10 }, aura: '#8a3cff' },
  // ── Legendarios ──
  TeseractCell:      { name: 'Célula del Teseracto',       rarity: 'legendary', desc: '+30% daño, -20% enfriamientos', mods: { dmg: 0.30, cd: 0.20 }, aura: '#3d7bff' },
  DarkSpiritOrb:     { name: 'Orbe del Espíritu Oscuro',   rarity: 'legendary', tags: ['symbiote', 'dark'], desc: '+10% robo de vida, +20% daño', mods: { lifesteal: 0.10, dmg: 0.20 }, aura: '#5a6aff' },
  BlueSoulSkull:     { name: 'Fuego Azul de Zadkiel',      rarity: 'legendary', tags: ['mystic'], blueFire: true, desc: '+15% daño (místico). Ghost Rider: llamas azules (+25% daño y quemaduras x2)', mods: { dmg: 0.15 }, aura: '#4fc8ff' },
};

// Ítems sin icono propio (se dibujan con el icono genérico de su rareza).
const LEGACY = {
  placa:      { name: 'Placa de Vibranium',     rarity: 'common', tags: ['armor'], desc: '+8% reducción de daño (armadura)', mods: { armor: 0.08 } },
  frag_simb:  { name: 'Fragmento de Simbionte', rarity: 'common', tags: ['symbiote'], desc: '+4% robo de vida, +5% daño', mods: { lifesteal: 0.04, dmg: 0.05 } },
  honda:      { name: 'Anillo de Honda',        rarity: 'rare', tags: ['mystic'], desc: '-20% enfriamiento de dash, +6% daño (místico)', mods: { dashCd: 0.20, dmg: 0.06 } },
  traje_simb: { name: 'Traje Simbionte',        rarity: 'epic', tags: ['symbiote'], desc: '+8% robo de vida, +10% velocidad', mods: { lifesteal: 0.08, speed: 0.10 } },
  nanotech:   { name: 'Nanotecnología Stark',   rarity: 'epic', tags: ['armor'], desc: '+8% reducción de daño, +12% daño (armadura)', mods: { armor: 0.08, dmg: 0.12 } },
  fenix:      { name: 'Pluma del Fénix',        rarity: 'legendary', desc: '+1% regeneración/s, +25% vida máxima', mods: { regen: 0.01, hp: 0.25 } },
};

// PNG nuevos que no están en la tabla: estadísticas por palabras clave del nombre de archivo.
const KEYWORD_RULES = [
  [/boot|shoe|jet/i,              { desc: '+10% velocidad', mods: { speed: 0.10 } }],
  [/serum|potion|heal|med/i,      { desc: '+15% vida máxima y curación total', mods: { hp: 0.15 }, onPick: 'healFull' }],
  [/shield|armor|armour|plate/i,  { desc: '+8% reducción de daño (armadura)', mods: { armor: 0.08 }, tags: ['armor'] }],
  [/claw|blade|sword|axe|knife/i, { desc: '+20% daño cuerpo a cuerpo', mods: { melee: 0.20 } }],
  [/crystal|gem|core|cell|iso/i,  { desc: '+20% daño de habilidad', mods: { ability: 0.20 } }],
  [/grenade|bomb|barrel/i,        { desc: 'Granada periódica (daño en área)', mods: {}, active: 'grenade' }],
  [/drone|bot/i,                  { desc: 'Dron que dispara al enemigo más cercano', mods: {}, active: 'drone' }],
  [/tome|book|eye|cloak|mirror|amulet/i, { desc: '-12% enfriamientos (místico)', mods: { cd: 0.12 }, tags: ['mystic'] }],
  [/dark|void|symb|venom/i,       { desc: '+15% daño, +3% robo de vida', mods: { dmg: 0.15, lifesteal: 0.03 }, tags: ['dark'] }],
];
const prettify = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');

function scanIcons() {
  const dirs = [
    path.join(__dirname, '..', '..', 'public', 'sprites_processed', 'items'),
    path.join(__dirname, '..', '..', 'sprites', 'items'),
  ];
  for (const d of dirs) {
    try {
      const files = fs.readdirSync(d).filter((f) => /\.png$/i.test(f));
      if (files.length) return { dir: d, names: files.map((f) => f.replace(/\.png$/i, '')) };
    } catch (e) { /* carpeta inexistente */ }
  }
  return { dir: null, names: [] };
}

const ITEMS = {};
const icons = scanIcons();
for (const name of icons.names) {
  const known = ITEM_TABLE[name];
  if (known) { ITEMS[name] = Object.assign({ icon: name }, known); continue; }
  const rule = KEYWORD_RULES.find(([re]) => re.test(name));
  const base = rule ? rule[1] : { desc: '+8% daño', mods: { dmg: 0.08 } };
  ITEMS[name] = Object.assign({ name: prettify(name), rarity: 'rare', icon: name, auto: true }, base);
}
// Ítems de la tabla cuyo PNG falta: siguen existiendo, sin icono (respaldo en el cliente).
for (const [id, it] of Object.entries(ITEM_TABLE)) if (!ITEMS[id]) ITEMS[id] = Object.assign({}, it);
for (const [id, it] of Object.entries(LEGACY)) ITEMS[id] = Object.assign({}, it);

const BY_RARITY = { common: [], rare: [], epic: [], legendary: [] };
for (const [id, it] of Object.entries(ITEMS)) BY_RARITY[it.rarity].push(id);

const hasTag = (id, tag) => !!(ITEMS[id] && ITEMS[id].tags && ITEMS[id].tags.includes(tag));
const countTag = (items, tag) => items.filter((id) => hasTag(id, tag)).length;

// bonus = probabilidad extra de rareza (mejora de tienda + suerte del personaje + ítems).
function rollRarity(bonus = 0) {
  const r = Math.random();
  if (r < 0.02 + bonus * 0.35) return 'legendary';
  if (r < 0.12 + bonus * 0.9) return 'epic';
  if (r < 0.42 + bonus * 1.4) return 'rare';
  return 'common';
}

function rollItem(bonus = 0, forceRarity = null) {
  const list = BY_RARITY[forceRarity || rollRarity(bonus)];
  return list[Math.floor(Math.random() * list.length)];
}

// Texto corto flotante al recoger el ítem.
function shortEffect(it) {
  const m = it.mods || {};
  const parts = [];
  const pct = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
  if (m.dmg) parts.push(`${pct(m.dmg)} daño`);
  if (m.melee) parts.push(`${pct(m.melee)} cuerpo a cuerpo`);
  if (m.ability) parts.push(`${pct(m.ability)} habilidad`);
  if (m.hp) parts.push(`${pct(m.hp)} vida`);
  if (m.speed) parts.push(`${pct(m.speed)} velocidad`);
  if (m.armor) parts.push(`${pct(m.armor)} armadura`);
  if (m.shield) parts.push('Escudo');
  if (m.crit) parts.push(`${pct(m.crit)} crítico`);
  if (m.atkSpeed) parts.push(`${pct(m.atkSpeed)} vel. ataque`);
  if (m.cd) parts.push(`-${Math.round(m.cd * 100)}% enfriam.`);
  if (m.dashCd) parts.push(`-${Math.round(m.dashCd * 100)}% dash`);
  if (m.lifesteal) parts.push(`${pct(m.lifesteal)} robo vida`);
  if (it.active === 'grenade') parts.push('Granada gamma');
  if (it.active === 'drone') parts.push('Dron espía');
  if (it.poison) parts.push('Veneno');
  if (it.onPick === 'healFull') parts.push('Curación');
  return parts.slice(0, 2).join(' · ') || it.name;
}

module.exports = { ITEMS, rollItem, hasTag, countTag, shortEffect, ICON_DIR: icons.dir };
