'use strict';
// Sala: lobby (selección, tienda, listo) + ciclo de la run (World) + red.
const nid = require('../ids');
const profiles = require('../profiles');
const shop = require('../shop');
const { World } = require('./world');
const { CHARS, charMeta } = require('./characters');
const { ITEMS } = require('./items');
const { GEMS, GEM_ORDER } = require('./gems');
const { BOSSES } = require('./bosses');
const { ENEMIES } = require('./enemies');
const { synergyMeta } = require('./synergies');
const { CURSES } = require('./curses');

const STEP = 1 / 60;        // simulación a 60 Hz
const SNAPSHOT_EVERY = 2;   // estado a 30 Hz
const MAX_PLAYERS = 4;

function isUnlocked(profile, id) {
  const c = CHARS[id];
  return !!c && (!c.hidden || !!profile.unlocked[id]);
}

// Metadatos estáticos que el cliente necesita para dibujar y mostrar textos.
const STATIC_META = {
  chars: charMeta(),
  items: Object.fromEntries(Object.entries(ITEMS).map(([id, it]) => [id, { name: it.name, rarity: it.rarity, desc: it.desc, tags: it.tags || [], icon: it.icon || '', aura: it.aura || '', mods: it.mods || {}, active: it.active || '', poison: it.poison || 0 }])),
  synergies: synergyMeta(),
  curses: CURSES,
  gems: GEMS,
  gemOrder: GEM_ORDER,
  bosses: Object.fromEntries(Object.entries(BOSSES).map(([id, b]) => [id, { name: b.name, title: b.title, color: b.color, r: b.r }])),
  enemies: Object.fromEntries(Object.entries(ENEMIES).map(([id, e]) => [id, { name: e.name, color: e.color }])),
};

class Room {
  constructor(code, onEmpty) {
    this.code = code;
    this.onEmpty = onEmpty;
    this.clients = new Map();
    this.phase = 'lobby';
    this.world = null;
    this.frame = 0;
    this.acc = 0;
    this.last = process.hrtime.bigint();
    this.timer = setInterval(() => this.tick(), 1000 / 60);
  }

  send(c, m) { c.conn.send(JSON.stringify(m)); }
  broadcast(m) {
    const s = JSON.stringify(m);
    for (const c of this.clients.values()) c.conn.send(s);
  }
  // Solo a quienes están dentro de la run.
  broadcastRun(m) {
    const s = JSON.stringify(m);
    for (const c of this.clients.values()) if (c.inRun) c.conn.send(s);
  }

  join(conn, name) {
    if (this.clients.size >= MAX_PLAYERS) return { error: `La sala ${this.code} está llena (máx. ${MAX_PLAYERS}).` };
    for (const c of this.clients.values()) {
      if (c.name.toLowerCase() === name.toLowerCase()) return { error: 'Ese nombre ya está en uso en esta sala.' };
    }
    const profile = profiles.get(name);
    const c = { id: nid(), conn, name, profile, room: this, charId: 'ironman', ready: false, inRun: false };
    this.clients.set(c.id, c);
    this.send(c, {
      t: 'welcome', id: c.id, code: this.code,
      profile: profiles.publicProfile(profile), shop: shop.catalog(profile),
      ...STATIC_META,
    });
    if (this.phase === 'run') this.send(c, { t: 'toast', text: 'Hay una run en curso: entrarás en la siguiente.', c: '#ffd76a' });
    this.broadcastLobby();
    return { client: c };
  }

  leave(c) {
    if (!this.clients.has(c.id)) return;
    this.clients.delete(c.id);
    if (this.world) {
      this.world.removePlayer(c.id);
      if (this.world.players.size > 0) this.world.toast(`${c.name} se ha desconectado`, '#ff9a9a');
    }
    this.broadcastLobby();
    // Si el que se fue era el único que no estaba listo, la partida empieza.
    if (this.phase === 'lobby' && this.clients.size && [...this.clients.values()].every((x) => x.ready)) this.startRun();
    this.cleanupIfEmpty();
  }

  cleanupIfEmpty() {
    if (this.clients.size === 0) {
      clearInterval(this.timer);
      this.world = null;
      this.onEmpty();
    }
  }

  broadcastLobby() {
    this.broadcast({
      t: 'lobby', code: this.code, phase: this.phase,
      players: [...this.clients.values()].map((c) => ({ id: c.id, name: c.name, charId: c.charId, ready: c.ready, inRun: c.inRun })),
    });
  }

  onMessage(c, m) {
    switch (m.t) {
      case 'pick':
        if (this.phase !== 'lobby' || c.ready) return;
        if (!isUnlocked(c.profile, m.c)) { this.send(c, { t: 'toast', text: 'Ese personaje sigue bloqueado.', c: '#ff8080' }); return; }
        c.charId = m.c;
        this.broadcastLobby();
        break;
      case 'ready':
        if (this.phase !== 'lobby') return;
        if (!isUnlocked(c.profile, c.charId)) c.charId = 'ironman';
        c.ready = !!m.v;
        this.broadcastLobby();
        if ([...this.clients.values()].every((x) => x.ready)) this.startRun();
        break;
      case 'buy': {
        if (this.phase !== 'lobby' && !(this.phase === 'run' && !c.inRun)) return;
        const r = shop.buy(c.profile, String(m.stat));
        if (r.ok) profiles.save();
        this.send(c, { t: 'profile', profile: profiles.publicProfile(c.profile), shop: shop.catalog(c.profile) });
        this.send(c, { t: 'toast', text: r.msg, c: r.ok ? '#7fffb0' : '#ff8080' });
        break;
      }
      case 'in':
        if (this.world && c.inRun) this.world.onInput(c.id, m);
        break;
      case 'drop':   // [G] / Shift+clic / clic central en una ranura del inventario
        if (this.world && c.inRun) this.world.dropItem(this.world.players.get(c.id), Number.isInteger(m.slot) ? m.slot : null);
        break;
      default:
        break;
    }
  }

  startRun() {
    const members = [...this.clients.values()].map((c) => ({ client: c, profile: c.profile, charId: c.charId }));
    if (!members.length) return;
    for (const c of this.clients.values()) { c.inRun = true; }
    this.phase = 'run';
    this.frame = 0;
    this.acc = 0;
    this.last = process.hrtime.bigint();
    this.broadcast({ t: 'start' });
    this.world = new World(this, members);
    this.broadcastLobby();
  }

  tick() {
    const now = process.hrtime.bigint();
    const dt = Number(now - this.last) / 1e9;
    this.last = now;
    if (!this.world) return;
    // Pausa total si no queda nadie conectado dentro de la run (la IA y las físicas no corren).
    if (![...this.clients.values()].some((c) => c.inRun)) { this.acc = 0; return; }
    this.acc += Math.min(dt, 0.25);
    let steps = 0;
    try {
      while (this.acc >= STEP && steps < 5) {
        this.world.update(STEP);
        this.acc -= STEP;
        steps++;
        this.frame++;
        if (this.world.over) break;
        if (this.frame % SNAPSHOT_EVERY === 0) this.sendSnapshot();
      }
      this.errors = 0;
    } catch (e) {
      console.error('[world] error en la simulación:', e);
      // Un error que se repite en cada tick no debe dejar la sala colgada: se cierra la run.
      if (++this.errors > 30 && this.world) { this.world.toast('Error del servidor: la run se ha cerrado', '#ff8080'); this.world.endRun(false); }
    }
    if (this.world && this.world.over) this.finishRun();
  }

  sendSnapshot() {
    const s = this.world.snapshot();
    for (const c of this.clients.values()) {
      if (c.inRun && c.conn.buffered < 512 * 1024) c.conn.send(s);
    }
  }

  finishRun() {
    const res = this.world.result;
    this.world = null;
    this.phase = 'lobby';
    for (const c of this.clients.values()) {
      if (res && c.inRun) {
        const pr = res.players.find((x) => x.id === c.id);
        if (pr) {
          c.profile.iso8 += pr.iso;
          c.profile.stats.runs++;
          if (res.win) c.profile.stats.wins++;
          c.profile.stats.bestFloor = Math.max(c.profile.stats.bestFloor, res.floor);
        }
        this.send(c, { t: 'end', summary: res, profile: profiles.publicProfile(c.profile), shop: shop.catalog(c.profile) });
      }
      c.inRun = false;
      c.ready = false;
    }
    profiles.save();
    this.broadcastLobby();
  }
}

module.exports = { Room, isUnlocked };
