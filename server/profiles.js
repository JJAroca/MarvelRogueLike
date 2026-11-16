'use strict';
// Persistencia de perfiles de usuario (Iso-8, mejoras permanentes, desbloqueos).
// Se guarda en data/profiles.json, con escritura atómica y diferida.
const fs = require('fs');
const path = require('path');

// DATA_DIR permite guardar los perfiles en un volumen persistente (p. ej. /data en Fly.io).
const BUNDLED = path.join(__dirname, '..', 'data');
const DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : BUNDLED;
const FILE = path.join(DIR, 'profiles.json');

// Primer arranque con un volumen vacío: se copian los perfiles incluidos en el proyecto.
if (DIR !== BUNDLED && !fs.existsSync(FILE)) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.copyFileSync(path.join(BUNDLED, 'profiles.json'), FILE);
    console.log('[perfiles] copiados al volumen', FILE);
  } catch (e) { /* sin perfiles iniciales */ }
}

let db = {};
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch (e) { db = {}; }

let timer = null;

const key = (name) => String(name).trim().toLowerCase();

function normalize(p, name) {
  p.name = p.name || name;
  p.iso8 = Number.isFinite(p.iso8) ? p.iso8 : 0;
  p.upgrades = Object.assign({ hp: 0, dmg: 0, speed: 0, rare: 0 }, p.upgrades);
  p.unlocked = p.unlocked || {};
  // Spider-Man clásico se retiró: quien lo tenía desbloqueado recibe a Spider-Man 2099.
  if (p.unlocked.spiderman) p.unlocked.spider2099 = true;
  p.stats = Object.assign({ runs: 0, wins: 0, bestFloor: 0 }, p.stats);
  return p;
}

function get(name) {
  const k = key(name);
  if (!db[k]) { db[k] = {}; save(); }
  return normalize(db[k], name);
}

function writeNow() {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

function save() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try { writeNow(); } catch (e) { console.error('[perfiles] error al guardar:', e.message); }
  }, 400);
}

function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  try { writeNow(); } catch (e) { /* ignore */ }
}

function publicProfile(p) {
  return { name: p.name, iso8: p.iso8, upgrades: p.upgrades, unlocked: p.unlocked, stats: p.stats };
}

module.exports = { get, save, flush, publicProfile };
