'use strict';
// Mundo de una run: simulación autoritativa (60 Hz). El cliente solo envía input
// y dibuja el snapshot, así que todo lo que pasa aquí está sincronizado.
const nid = require('../ids');
const profiles = require('../profiles');
const shop = require('../shop');
const unlocks = require('../unlocks');
const { CHARS } = require('./characters');
const { ENEMIES, updateEnemy } = require('./enemies');
const { BOSSES } = require('./bosses');
const { ITEMS, rollItem, shortEffect } = require('./items');
const { GEMS, GEM_ORDER } = require('./gems');
const { genFloor, branchSpec, rollBossPlan, neighbors } = require('./floors');
const curses = require('./curses');
const { BY_ID: SYN, activeSynergies } = require('./synergies');

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const d2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
const ri = Math.round;
const r2 = (v) => Math.round(v * 100) / 100;

const RARITY_COLOR = { common: '#cfd6e0', rare: '#4fa8ff', epic: '#c06bff', legendary: '#ffb52e' };
const CHAOS_LABEL = { burn: 'Quemadura', freeze: 'Congelado', slow: 'Lentitud', poison: 'Veneno', confuse: 'Confusión', weaken: 'Debilidad' };
const STATUS_BITS = { freeze: 1, burn: 2, bleed: 4, poison: 8, confuse: 16, slow: 32, weaken: 64 };
const DASH_CD = 1.2;
// Vida de los jefes según jugadores (1P 100% · 2P 155% · 3P 200% · 4P 240%).
const BOSS_HP_SCALE = [1, 1, 1.55, 2.0, 2.4];
const DOUBLE_BOSS_HP = 0.75;   // cada jefe de una pareja tiene el 75% de su vida base
const GOBLIN_CHANCE = 0.3;
// Red: los datos casi estáticos (sala, portales, gemas, sinergias, datos fijos de cada jugador)
// solo se envían cuando cambian, y completos cada KEYFRAME snapshots (1 s) por si se perdió alguno.
const KEYFRAME = 30;
const P_STATIC = ['n', 'c', 'r', 'fm', 'mh', 'sm', 'au', 'cm'];     // prob. de que un Goblin Saqueador acompañe la 1ª oleada (1 por piso)
const SHIELD_DELAY = 4;     // s sin recibir daño antes de recargar el escudo
const SHIELD_REGEN = 0.12;  // fracción del escudo máximo por segundo
const GRENADE_CD = 5;       // Granada Gamma
const MAX_ITEMS = 6;        // inventario activo (hotbar de 6 ranuras)
const HURT_IFRAMES = 0.45;  // invulnerabilidad tras recibir un golpe (el cliente parpadea)
const DROP_LOCK = 1.2;      // quien suelta un ítem no puede recogerlo de nuevo durante este tiempo
// Sprites de output_effects para los tajos cuerpo a cuerpo de cada héroe.
const SLASH_SPRITE = { ghostrider: 'GhostRiderAtack', wolverine: 'CrimsonSlash', spider2099: 'CrimsonSlash', venom: 'CrimsonSlash' };
const DRONE_CD = 0.8;       // Dron Espía
const REVIVE_TIME = 10;     // segundos manteniendo [F] para reanimar
const REVIVE_RANGE = 75;
const ASTRAL_AFTER = 20;    // segundos caído antes de pasar a Forma Astral
const ASTRAL_SPEED = 0.75;

class World {
  constructor(room, members) {
    this.room = room;
    this.time = 0;
    this.players = new Map();
    this.enemies = [];
    this.projs = [];
    this.hazards = [];
    this.pickups = [];
    this.decoys = [];
    this.fx = [];
    this.sched = [];
    this.gems = new Set();
    this.pull = null;
    this.transition = null;
    this.bossId = 0;
    this.over = false;
    this.result = null;
    this.stats = { roomsCleared: 0, bosses: 0, kills: 0, secretFound: false, secretBoss: false, doubleBosses: 0 };
    this.secretFloor = 1 + Math.floor(Math.random() * 3); // la Sala Secreta aparece en el piso 1, 2 o 3
    this.bossPlan = rollBossPlan();   // jefes de cada piso (1 · 1 · 2 · 2), fijan el bioma
    this.bossIds = [];
    this.curse = null;                // Sobrecarga Cósmica activa
    this.gauntlet = false;            // Poder del Guantelete (6 gemas)
    this.roomState = new Map();       // salas ya despejadas (para volver a ellas)
    this.goblinChase = null;          // { room, itemId } Goblin huido a otra sala
    this.synergies = [];
    this.visited = new Set();
    for (const m of members) this.addPlayer(m);
    this.computeSynergies();
    this.loadFloor(1);
  }

  // ───────────────────────── Jugadores ─────────────────────────
  addPlayer({ client, profile, charId }) {
    const def = CHARS[charId] || CHARS.ironman;
    const p = {
      id: client.id, client, profile, name: client.name, charId: def.id, def,
      x: 0, y: 0, r: def.r || 16, aim: 0, hp: 1, maxHp: 0, items: [],
      up: shop.bonuses(profile),
      input: { k: 0, ax: 0, ay: 0, atk: false, revive: false },
      pending: { dash: 0, ab: 0, ult: 0 },
      cd: { atk: 0, dash: 0, ab: 0, ult: 0 },
      dashT: 0, dashVx: 0, dashVy: 0, invulnT: 0, invisT: 0, atkT: 0,
      downed: false, downT: 0, revive: 0, astral: false, st: {}, buffs: {},
      mode: 'tank', berserk: false, usedRevive: false, form: '',
      shield: 0, shieldMax: 0, sinceHit: 99, stunT: 0, pickT: 0, pickC: '', itemCd: {}, auras: [],
      run: { damageTaken: 0, deaths: 0, darkItems: 0, floorStart: 0, floorHit: false, kills: 0, dealt: 0 },
    };
    this.players.set(p.id, p);
    if (def.init) def.init(this, p);
    this.recalc(p);
    p.hp = p.maxHp;
  }

  // Desconexión: se limpia todo lo que pertenece al jugador y sus ítems quedan en el suelo
  // para que el resto del equipo pueda recogerlos. La sala sigue funcionando.
  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    if (this.players.size === 0) { this.over = true; this.result = null; return; }
    if (this.cur && !this.over) {
      p.items.forEach((itemId, i) => {
        const a = (i / Math.max(1, p.items.length)) * TAU;
        const it = ITEMS[itemId];
        this.spawnPickup('item', clamp(p.x + Math.cos(a) * 46, 30, this.cur.w - 30), clamp(p.y + Math.sin(a) * 46, 30, this.cur.h - 30), { itemId, rarity: it ? it.rarity : 'common' });
      });
    }
    this.projs = this.projs.filter((q) => !(q.side === 'p' && q.ownerId === id));
    this.decoys = this.decoys.filter((d) => d.ownerId !== id);
    this.hazards = this.hazards.filter((h) => h.ownerId !== id && h.targetId !== id);
    if (this.transition && this.transition.door) this.transition.door.count = 0;
    this.computeSynergies();
  }

  // Sinergias cooperativas (ver synergies.js): se aplican a todo el equipo en recalc().
  computeSynergies() {
    const ids = activeSynergies([...this.players.values()].map((p) => p.charId));
    const added = ids.filter((s) => !this.synergies.includes(s));
    const changed = added.length || ids.length !== this.synergies.length;
    this.synergies = ids;
    if (!changed) return;
    for (const p of this.players.values()) {
      this.recalc(p);
      if (added.some((s) => SYN[s].shieldOnEnter)) p.shield = p.shieldMax;
    }
    for (const s of added) {
      const S = SYN[s];
      this.toast(`🤝 Sinergia «${S.name}»: ${S.desc}`, S.color);
    }
  }

  // [G] / Shift+clic / clic central: soltar un ítem (el seleccionado o el último recogido).
  dropItem(p, slot) {
    if (!p || p.downed || this.over || this.transition || !this.cur) return false;
    if (this.time < (p.dropCd || 0) || !p.items.length) return false;
    let i = Number.isInteger(slot) && slot >= 0 && slot < p.items.length ? slot : p.items.lastIndexOf(p.lastPick);
    if (i < 0) i = p.items.length - 1;
    const id = p.items.splice(i, 1)[0];
    p.dropCd = this.time + 0.25;
    this.recalc(p);
    const it = ITEMS[id] || { rarity: 'common', name: id };
    const x = clamp(p.x + Math.cos(p.aim) * 44, 30, this.cur.w - 30), y = clamp(p.y + Math.sin(p.aim) * 44, 30, this.cur.h - 30);
    this.spawnPickup('item', x, y, { itemId: id, rarity: it.rarity, lockId: p.id, lockT: this.time + DROP_LOCK });
    this.fxText(p.x, p.y - 46, `Soltado: ${it.name}`, '#cfd6e0');
    this.fx.push({ k: 'sfx', s: 'drop', x: ri(p.x), y: ri(p.y) });
    p.client.conn.send(JSON.stringify({ t: 'inv', items: p.items }));
    return true;
  }

  onInput(id, m) {
    const p = this.players.get(id);
    if (!p) return;
    p.input.k = (m.k | 0) & 63;
    if (Number.isFinite(m.ax)) p.input.ax = clamp(m.ax, -4000, 6000);
    if (Number.isFinite(m.ay)) p.input.ay = clamp(m.ay, -4000, 6000);
    p.input.atk = (p.input.k & 16) !== 0;
    p.input.revive = (p.input.k & 32) !== 0;   // [F] mantenido
    if (m.d) p.pending.dash = 1;
    if (m.s) p.pending.ab = 1;
    if (m.q) p.pending.ult = 1;
  }

  // Jugadores activos (ni caídos ni en Forma Astral).
  alivePlayers() { return [...this.players.values()].filter((p) => !p.downed && !p.astral); }

  recalc(p) {
    const def = p.def, up = p.up;
    const m = { hp: 0, dmg: 0, speed: 0, armor: 0, crit: 0, lifesteal: 0, regen: 0, atkSpeed: 0, cd: 0, dashCd: 0, shield: 0, melee: 0, ability: 0, luck: 0 };
    let poison = 0;
    const auras = [];
    for (const id of p.items) {
      const it = ITEMS[id];
      if (!it) continue;
      for (const k in it.mods) m[k] = (m[k] || 0) + it.mods[k];
      if (it.poison) poison += it.poison;
      if (it.aura && !auras.includes(it.aura)) auras.push(it.aura);
    }
    let burnOnHit = false;
    for (const sid of this.synergies || []) {
      const S = SYN[sid];
      for (const k in S.mods) m[k] = (m[k] || 0) + S.mods[k];
      if (S.burn) burnOnHit = true;
    }
    p.burnOnHit = burnOnHit;
    p.auras = auras.slice(-3);
    p.poisonChance = Math.min(0.6, poison);
    p.meleeMult = 1 + m.melee;
    p.abilityMult = 1 + m.ability;
    if (this.gems.has('poder')) m.dmg += 0.2;
    if (this.gems.has('espacio')) m.dashCd += 0.4;
    if (this.gems.has('tiempo')) m.cd += 0.25;
    if (this.gems.has('realidad')) m.crit += 0.1;
    if (this.gems.has('alma')) m.lifesteal += 0.05;
    // Poder del Guantelete (6 gemas): buff masivo para todo el equipo.
    if (this.gauntlet) { m.dmg += 0.5; m.speed += 0.15; m.cd += 0.25; m.armor += 0.1; m.regen += 0.01; }

    const ratio = p.maxHp > 0 ? p.hp / p.maxHp : 1;
    p.maxHp = Math.round(def.hp * up.hp * Math.max(0.3, 1 + m.hp));
    p.dmgMult = up.dmg * Math.max(0.2, 1 + m.dmg);
    p.speed = def.speed * up.speed * Math.max(0.5, 1 + m.speed);
    p.armor = (def.armor || 0) + m.armor;
    p.crit = (def.crit || 0.05) + m.crit;
    p.lifesteal = m.lifesteal;
    p.regen = (def.regen || 0) + m.regen;
    p.atkSpeed = 1 + m.atkSpeed;
    p.cdMult = Math.max(0.4, 1 - m.cd);
    p.dashCdMult = Math.max(0.3, 1 - m.dashCd);
    p.luck = up.rare + (def.luck || 0) + m.luck;
    if (def.modStats) def.modStats(p);   // formas (Hulk-Buster, Banner, Moto...) pueden cambiar maxHp
    p.hp = Math.min(p.maxHp, ratio * p.maxHp);
    p.armor = Math.min(0.6, p.armor);
    p.shieldMax = Math.round(p.maxHp * m.shield);
    p.shield = Math.min(p.shield, p.shieldMax);
  }

  // Forma Astral: 25% del daño.
  dmgMultOf(p) {
    return p.dmgMult * (p.buffs.avengers > 0 ? 1.3 : 1) * (p.st.weaken > 0 ? 0.6 : 1) * (p.astral ? 0.25 : 1);
  }

  healPlayer(p, amt) {
    if (p.downed || p.astral || amt <= 0) return;
    p.hp = Math.min(p.maxHp, p.hp + amt);
  }

  updatePlayer(p, dt) {
    const inp = p.input;
    p.aim = Math.atan2(inp.ay - p.y, inp.ax - p.x);
    for (const k in p.cd) if (p.cd[k] > 0) p.cd[k] -= dt;
    if (p.invulnT > 0) p.invulnT -= dt;
    if (p.invisT > 0) p.invisT -= dt;
    if (p.atkT > 0) p.atkT -= dt;
    if (p.stunT > 0) p.stunT -= dt;
    if (p.pickT > 0) p.pickT -= dt;
    p.sinceHit += dt;
    if (p.shieldMax > 0 && p.shield < p.shieldMax && p.sinceHit > SHIELD_DELAY && !p.downed) {
      p.shield = Math.min(p.shieldMax, p.shield + p.shieldMax * SHIELD_REGEN * dt);
    }
    for (const b in p.buffs) if (p.buffs[b] > 0) p.buffs[b] -= dt;
    if (!p.astral) this.tickStatuses(p, dt, true);

    // Caído: un aliado debe MANTENER [F] 10 s a su lado. Tras 20 s sin ser
    // reanimado pasa a Forma Astral (25% de daño, intangible) hasta limpiar la sala.
    if (p.downed) {
      p.pending.dash = p.pending.ab = p.pending.ult = 0;
      let helper = null;
      for (const o of this.players.values()) {
        if (o !== p && !o.downed && !o.astral && o.input.revive && d2(o, p) < REVIVE_RANGE * REVIVE_RANGE) { helper = o; break; }
      }
      if (helper) {
        p.revive += dt;
        if (p.revive >= REVIVE_TIME) {
          p.downed = false; p.hp = p.maxHp * 0.35; p.invulnT = 1.5; p.revive = 0; p.downT = 0;
          this.fxText(p.x, p.y - 30, '¡Reanimado!', '#7fff9a');
          this.toast(`${helper.name} ha reanimado a ${p.name}`, '#7fff9a');
          unlocks.onRevive(this, helper);
        }
      } else {
        p.revive = Math.max(0, p.revive - dt);
        p.downT += dt;
        if (p.downT >= ASTRAL_AFTER) {
          p.downed = false; p.astral = true; p.revive = 0; p.downT = 0; p.st = {};
          p.hp = p.maxHp * 0.25;
          this.fx.push({ k: 'ring', x: ri(p.x), y: ri(p.y), r: 80, c: '#8fe8ff' });
          this.toast(`👻 ${p.name} entra en Forma Astral (25% de daño) hasta que limpiéis la sala`, '#8fe8ff');
        }
      }
      return;
    }

    if (!p.astral && p.regen > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * p.regen * dt);
    if (p.def.update) p.def.update(this, p, dt);
    if (!p.astral) this.updateItemActives(p, dt);

    const frozen = p.st.freeze > 0 || p.stunT > 0;   // congelado o ATURDIDO (roca de Juggernaut)
    let mx = 0, my = 0;
    if (inp.k & 1) my -= 1;
    if (inp.k & 2) my += 1;
    if (inp.k & 4) mx -= 1;
    if (inp.k & 8) mx += 1;
    if (p.st.confuse > 0) { mx = -mx; my = -my; }
    const ml = Math.hypot(mx, my);
    if (ml > 0) { mx /= ml; my /= ml; }

    if (p.dashT > 0) {
      p.dashT -= dt;
      p.x += p.dashVx * dt;
      p.y += p.dashVy * dt;
    } else if (!frozen) {
      const sp = p.speed * (p.st.slow > 0 ? 0.55 : 1) * (p.astral ? ASTRAL_SPEED : 1) * curses.playerSpeed(this);
      p.x += mx * sp * dt;
      p.y += my * sp * dt;
      if (this.pull) {
        const dx = this.pull.x - p.x, dy = this.pull.y - p.y, d = Math.hypot(dx, dy) || 1;
        if (d > 20) { p.x += (dx / d) * this.pull.s * dt; p.y += (dy / d) * this.pull.s * dt; }
      }
    }
    this.clampToRoom(p);

    if (frozen) { p.pending.dash = p.pending.ab = p.pending.ult = 0; return; }

    if (p.pending.dash) {
      p.pending.dash = 0;
      if (p.cd.dash <= 0 && p.dashT <= 0) this.startDash(p, { angle: ml > 0 ? Math.atan2(my, mx) : p.aim });
    }
    if (p.pending.ab) {
      p.pending.ab = 0;
      this.abCtx = p;   // el daño de habilidad/ulti recibe el bonus de habilidad (Cristal Iso-8...)
      const ok = p.def.ability && p.cd.ab <= 0 && p.def.ability(this, p) !== false;
      this.abCtx = null;
      if (ok) {
        p.cd.ab = p.def.abilityCd * (p.def.fixedAbilityCd ? 1 : p.cdMult);
        p.atkT = 0.35;
        this.fx.push({ k: 'sfx', s: p.charId === 'spider2099' ? 'chip_ab' : 'ab', c: p.charId, x: ri(p.x), y: ri(p.y) });
      }
    }
    if (p.pending.ult) {
      p.pending.ult = 0;
      this.abCtx = p;
      const ok = p.def.ult && p.cd.ult <= 0 && !p.astral && p.def.ult(this, p) !== false;
      this.abCtx = null;
      if (ok) {
        p.cd.ult = p.def.ultCd * p.cdMult;
        p.atkT = 0.45;
        this.fx.push({ k: 'sfx', s: p.charId === 'spider2099' ? 'chip_ult' : 'ult', c: p.charId, x: ri(p.x), y: ri(p.y) });
      }
    }
    if (inp.atk && p.cd.atk <= 0 && p.dashT <= 0) {
      const rate = typeof p.def.attackRate === 'function' ? p.def.attackRate(p) : p.def.attackRate;
      p.def.attack(this, p);
      p.cd.atk = (rate / p.atkSpeed) * (p.astral ? 1.5 : 1);
      p.atkT = 0.3;
    }
  }

  // Ítems con efecto propio: Granada Gamma (área) y Dron Espía (disparo automático).
  updateItemActives(p, dt) {
    if (p.stunT > 0) return;
    for (const id of p.items) {
      const it = ITEMS[id];
      if (!it || !it.active) continue;
      p.itemCd[id] = (p.itemCd[id] == null ? 1 : p.itemCd[id]) - dt;
      if (p.itemCd[id] > 0) continue;
      if (it.active === 'grenade') {
        const t = this.nearestHostile(p.x, p.y, 460);
        if (!t) { p.itemCd[id] = 0.4; continue; }
        p.itemCd[id] = GRENADE_CD;
        const a = Math.atan2(t.y - p.y, t.x - p.x), dist = Math.sqrt(d2(p, t));
        this.shoot(p, { angle: a, speed: 430, r: 8, dmg: 34, kind: 'gamma', life: Math.max(0.15, dist / 430), explodeR: 95, explodeDmg: 34 });
      } else if (it.active === 'drone') {
        const t = this.nearestHostile(p.x, p.y, 400);
        if (!t) { p.itemCd[id] = 0.3; continue; }
        p.itemCd[id] = DRONE_CD;
        // El dron orbita sobre el héroe (mismo cálculo que dibuja el cliente).
        const ox = p.x + Math.cos(this.time * 2.4) * 30, oy = p.y - 34 + Math.sin(this.time * 2.4) * 8;
        this.shoot(p, { angle: Math.atan2(t.y - oy, t.x - ox), speed: 720, r: 4, dmg: 7, kind: 'drone', life: 0.8, ox, oy });
      }
    }
  }

  startDash(p, { mult = 3.2, dur = 0.18, angle, noCd = false } = {}) {
    const a = angle != null ? angle : p.aim;
    const sp = p.def.speed * mult;
    const sx = p.x, sy = p.y;
    p.dashT = dur;
    p.dashVx = Math.cos(a) * sp;
    p.dashVy = Math.sin(a) * sp;
    p.invulnT = Math.max(p.invulnT, dur + 0.06);
    this.fx.push({ k: 'dash', x: ri(p.x), y: ri(p.y), a: r2(a), c: p.def.color2 || p.def.color, s: p.charId === 'ghostrider' ? 'GhostRiderDash' : undefined });
    if (p.charId === 'spider2099') this.fx.push({ k: 'sfx', s: 'chip_dash', x: ri(p.x), y: ri(p.y) });
    if (!noCd) {
      p.cd.dash = DASH_CD * p.dashCdMult;
      if (p.def.onDash) p.def.onDash(this, p, sx, sy);
    }
  }

  hurtPlayer(p, dmg, o = {}) {
    if (p.downed || p.astral || this.over) return 0;   // la Forma Astral es intangible
    if (!o.dot && (p.invulnT > 0 || p.dashT > 0)) return 0;
    // trueDmg (explosión kamikaze): % de la vida máxima sin reducir por armadura.
    if (!o.trueDmg) dmg *= (1 - p.armor) * (p.buffs.avengers > 0 ? 0.75 : 1);
    if (!o.dot) dmg *= curses.dmgMult(this);
    if (dmg <= 0) return 0;
    p.sinceHit = 0;
    if (o.stun && !(p.stunT > 0)) {
      p.stunT = o.stun;
      this.fxText(p.x, p.y - 40, '¡ATURDIDO!', '#ffd76a');
    }
    // Escudo de energía (Escudo de Reactor Arc): absorbe el daño antes que la vida.
    if (p.shield > 0) {
      const ab = Math.min(p.shield, dmg);
      p.shield -= ab;
      dmg -= ab;
      if (!o.dot && !o.hz) this.fx.push({ k: 'num', x: ri(p.x + 10), y: ri(p.y - 22), v: Math.max(1, ri(ab)), c: '#4fd8ff' });
      if (dmg <= 0) return ab;
    }
    p.hp -= dmg;
    if (!o.dot && !o.hz) {
      p.invulnT = Math.max(p.invulnT, HURT_IFRAMES);          // i-frames (parpadeo en el cliente)
      if (dmg >= p.maxHp * 0.12) this.fx.push({ k: 'shake', s: 7, p: p.id });
      if (this.time > (p.hurtSfxT || 0)) { p.hurtSfxT = this.time + 1.4; this.fx.push({ k: 'sfx', s: 'hurt', c: p.charId, x: ri(p.x), y: ri(p.y) }); }
    }
    p.run.damageTaken += dmg;
    p.run.floorHit = true;
    if (!o.dot && !o.hz) this.fx.push({ k: 'num', x: ri(p.x), y: ri(p.y - 22), v: Math.max(1, ri(dmg)), c: '#ff5a5a' });
    if (o.bleed) this.addStatus(p, 'bleed', 3, o.bleedDps || 4 * this.scale.dmg);
    if (p.hp <= 0) {
      p.hp = 0;
      if (!(p.def.onLethal && p.def.onLethal(this, p))) {
        p.downed = true;
        p.revive = 0;
        p.downT = 0;
        p.st = {};
        p.dashT = 0;
        p.run.deaths++;
        this.fxText(p.x, p.y - 30, '¡Derribado!', '#ff5a5a');
        this.fx.push({ k: 'sfx', s: 'down', c: p.charId, x: ri(p.x), y: ri(p.y) });
        this.toast(`${p.name} ha caído — mantén [F] 10 s a su lado para reanimarle (20 s antes de la Forma Astral)`, '#ff8080');
      }
    }
    unlocks.onDamageTaken(this, p);
    return dmg;
  }

  // ───────────────────────── Estados alterados ─────────────────────────
  addStatus(ent, k, dur, power) {
    ent.st[k] = Math.max(ent.st[k] || 0, dur);
    if (power != null) ent.st[k + 'Dps'] = power;
  }

  tickStatuses(ent, dt, isPlayer) {
    const st = ent.st;
    for (const k in STATUS_BITS) if (st[k] > 0) st[k] -= dt;
    let dot = 0;
    if (st.bleed > 0) dot += st.bleedDps || 0;
    if (st.burn > 0) dot += st.burnDps || 0;
    if (st.poison > 0) dot += st.poisonDps || 0;
    if (dot > 0) {
      ent.dotAcc = (ent.dotAcc || 0) + dot * dt;
      if (ent.dotAcc >= 1) {
        const d = Math.floor(ent.dotAcc);
        ent.dotAcc -= d;
        if (isPlayer) this.hurtPlayer(ent, d, { dot: true });
        else this.hurtEnemy(ent, d, { silent: true });
      }
    }
  }

  statusBits(ent) {
    let b = 0;
    for (const k in STATUS_BITS) if (ent.st[k] > 0) b |= STATUS_BITS[k];
    return b;
  }

  applyChaos(e, p) {
    const keys = Object.keys(CHAOS_LABEL);
    const k = keys[Math.floor(Math.random() * keys.length)];
    const m = p ? this.dmgMultOf(p) : 1;
    if (k === 'burn') this.addStatus(e, 'burn', 3, 7 * m);
    else if (k === 'poison') this.addStatus(e, 'poison', 4, 5 * m);
    else if (k === 'freeze') this.addStatus(e, 'freeze', e.boss ? 0.4 : 1.2);
    else if (k === 'confuse') { if (!e.boss) this.addStatus(e, 'confuse', 2.5); }
    else this.addStatus(e, k, k === 'weaken' ? 4 : 2.5);
    if (Math.random() < 0.35) this.fx.push({ k: 'text', x: ri(e.x), y: ri(e.y - e.r - 14), s: CHAOS_LABEL[k], c: '#ff4fa0' });
  }

  // ───────────────────────── Ataques de jugador ─────────────────────────
  shoot(p, o) {
    const a = o.angle != null ? o.angle : p.aim;
    const pr = {
      id: nid(), x: p.x + Math.cos(a) * (p.r + 4), y: p.y + Math.sin(a) * (p.r + 4),
      vx: Math.cos(a) * o.speed, vy: Math.sin(a) * o.speed, r: o.r || 5, dmg: o.dmg,
      side: 'p', ownerId: p.id, life: o.life || 1, pierce: o.pierce || 0, hit: new Set(),
      kind: o.kind || 'bolt', o: o.o || {}, metal: !!o.metal, homing: o.homing || 0,
      boomerang: !!o.boomerang, boomT: o.boomerang || 0, explodeR: o.explodeR || 0, explodeDmg: o.explodeDmg,
    };
    if (this.abCtx === p) pr.o = Object.assign({}, pr.o, { ab: 1 });
    if (o.ox != null) { pr.x = o.ox; pr.y = o.oy; }
    this.projs.push(pr);
    return pr;
  }

  hitEnemy(p, e, base, o = {}) {
    if (e.dead || e.spawning > 0) return 0;
    let dmg = base * (p ? this.dmgMultOf(p) : 1) * curses.dmgMult(this);
    if (p) {
      if (o.melee) dmg *= p.meleeMult || 1;                              // Garras de Adamantium
      if (o.ab || this.abCtx === p) dmg *= p.abilityMult || 1;           // Cristal Iso-8, Espejo Astral
    }
    let crit = false;
    if (p && Math.random() < p.crit + (o.critBonus || 0)) { crit = true; dmg *= o.critMult || 2; }
    const dealt = this.hurtEnemy(e, dmg, { crit, src: p });
    if (p && dealt >= 30) this.fx.push({ k: 'hit', p: p.id, x: ri(e.x), y: ri(e.y), h: dealt >= 60 ? 2 : 1 });
    if (dealt > 0 && !e.dead) {
      const m = p ? this.dmgMultOf(p) : 1;
      if (o.bleed) this.addStatus(e, 'bleed', 3, (o.bleedDps || 6) * m);
      if (o.burn) this.addStatus(e, 'burn', 3, (o.burnDps || 5) * m);
      if (o.freeze) this.addStatus(e, 'freeze', e.boss ? o.freeze * 0.35 : o.freeze);
      if (o.slow) this.addStatus(e, 'slow', o.slow);
      if (o.chaos) this.applyChaos(e, p);
      if (p && p.burnOnHit && !(e.st.burn > 0)) this.addStatus(e, 'burn', 3, 4 * m);   // Sinergia Sobrenatural
      if (p && p.poisonChance && Math.random() < p.poisonChance) this.addStatus(e, 'poison', 4, 5 * m);   // Barril Tóxico
      if (o.kb && !e.boss) {
        const from = o.kbFrom || p;
        if (from) {
          const a = Math.atan2(e.y - from.y, e.x - from.x);
          e.x += Math.cos(a) * o.kb * 0.18;
          e.y += Math.sin(a) * o.kb * 0.18;
          this.clampToRoom(e);
        }
      }
    }
    if (p && dealt > 0) {
      const ls = p.lifesteal + (o.lifesteal || 0);
      if (ls > 0) this.healPlayer(p, dealt * ls);
      p.run.dealt += dealt;
    }
    return dealt;
  }

  hurtEnemy(e, dmg, { crit = false, src = null, silent = false } = {}) {
    if (e.dead || e.spawning > 0) return 0;
    if (e.def.onHurt) dmg = e.def.onHurt(this, e, dmg);
    e.hp -= dmg;
    e.hitFlash = 0.08;
    if (!silent) this.fx.push({ k: 'num', x: ri(e.x), y: ri(e.y - e.r), v: Math.max(1, ri(dmg)), c: crit ? '#ffdd33' : '#ffffff', cr: crit ? 1 : 0 });
    if (e.hp <= 0) this.killEnemy(e, src);
    return dmg;
  }

  meleeArc(p, range, arc, dmg, o = {}, color = '#ffffff') {
    this.fx.push({ k: 'slash', x: ri(p.x), y: ri(p.y), a: r2(p.aim), r: range, arc: r2(arc), c: color, s: SLASH_SPRITE[p.charId] });
    let n = 0;
    for (const e of this.enemies) {
      if (e.dead || e.ally || e.spawning > 0) continue;
      const dx = e.x - p.x, dy = e.y - p.y, dist = Math.hypot(dx, dy);
      if (dist > range + e.r) continue;
      if (dist > e.r + p.r && Math.abs(angDiff(Math.atan2(dy, dx), p.aim)) > arc / 2 + Math.atan2(e.r, dist)) continue;
      this.hitEnemy(p, e, dmg, Object.assign({ melee: true }, o));
      n++;
    }
    return n;
  }

  aoeEnemies(p, x, y, r, dmg, o = {}) {
    const hits = [];
    const opts = Object.assign({ kbFrom: { x, y } }, o);
    for (const e of this.enemies) {
      if (e.dead || e.ally || e.spawning > 0) continue;
      const rr = r + e.r;
      if (d2(e, { x, y }) < rr * rr) { this.hitEnemy(p, e, dmg, opts); hits.push(e); }
    }
    return hits;
  }

  lineEnemies(p, x, y, a, len, width, dmg, o = {}) {
    const c = Math.cos(a), s = Math.sin(a);
    for (const e of this.enemies) {
      if (e.dead || e.ally || e.spawning > 0) continue;
      const dx = e.x - x, dy = e.y - y;
      const t = dx * c + dy * s;
      if (t < -e.r || t > len + e.r) continue;
      if (Math.abs(-dx * s + dy * c) < width / 2 + e.r) this.hitEnemy(p, e, dmg, o);
    }
  }

  hostiles() { return this.enemies.filter((e) => !e.dead && !e.ally && !(e.spawning > 0)); }

  nearestHostile(x, y, maxD = Infinity, exclude = null) {
    let best = null, bd = maxD * maxD;
    for (const e of this.enemies) {
      if (e.dead || e.ally || e.spawning > 0 || (exclude && exclude.has(e.id))) continue;
      const dd = d2(e, { x, y });
      if (dd < bd) { bd = dd; best = e; }
    }
    return best;
  }

  randomHostile() {
    const h = this.hostiles();
    return h.length ? h[Math.floor(Math.random() * h.length)] : null;
  }

  spawnDecoy(owner, x, y, life, dmg, r) {
    this.decoys.push({ id: nid(), x, y, life, dmg, r, ownerId: owner.id, charId: owner.charId, aim: owner.aim });
  }

  // ───────────────────────── Enemigos ─────────────────────────
  spawnEnemy(type, x, y, opts = {}) {
    const def = ENEMIES[type] || BOSSES[type];
    const isBoss = !!BOSSES[type] && !opts.clone;
    let hp = isBoss ? def.hp * this.bossHpScale * (opts.hpMult || 1) : def.hp * this.scale.hp * (opts.elite ? 2.5 : 1);
    if (opts.hp) hp = opts.hp;
    if (opts.illusion) hp = 1;
    const e = {
      id: nid(), type, def, x, y, r: def.r * (opts.elite ? 1.25 : 1), hp, maxHp: hp,
      speed: def.speed, spd: def.speed, boss: isBoss, clone: !!opts.clone, st: {}, ai: { t: 0 },
      contactCd: 0.5, contactBonus: 1, spawning: opts.noSpawnAnim ? 0 : 0.7, elite: !!opts.elite,
      ally: false, allyT: 0, face: 0, lifesteal: def.lifesteal || 0, master: opts.master || 0,
      illusion: !!opts.illusion,
    };
    this.enemies.push(e);
    if (isBoss && def.init) def.init(this, e);
    return e;
  }

  spawnAdds(type, count) {
    for (let i = 0; i < count; i++) {
      const pos = this.freeSpot(300);
      this.spawnEnemy(type, pos.x, pos.y);
    }
  }

  freeSpot(minD) {
    const c = this.cur;
    let x = c.w / 2, y = c.h / 2;
    for (let tries = 0; tries < 40; tries++) {
      x = 60 + Math.random() * (c.w - 120);
      y = 60 + Math.random() * (c.h - 120);
      let ok = true;
      for (const p of this.players.values()) if (d2(p, { x, y }) < minD * minD) { ok = false; break; }
      if (ok) break;
    }
    return { x, y };
  }

  enemyShoot(e, a, o) {
    const ally = e.ally;
    const dmg = ally ? o.dmg * 1.5 : o.dmg * this.scale.dmg * (e.st.weaken > 0 ? 0.6 : 1);
    e.atkT = 0.4;   // animación de ataque en el cliente
    const pr = {
      id: nid(), x: e.x + Math.cos(a) * e.r * 0.8, y: e.y + Math.sin(a) * e.r * 0.8,
      vx: Math.cos(a) * o.speed, vy: Math.sin(a) * o.speed, r: o.r || 6, dmg,
      side: ally ? 'p' : 'e', ownerId: 0, life: o.life || 3.5, pierce: 0, hit: new Set(),
      kind: o.kind || 'orb', o: o.o || {}, metal: !!o.metal, homing: 0, boomerang: false, explodeR: 0, srcId: e.id,
    };
    this.projs.push(pr);
    return pr;
  }

  enemyHitPlayer(e, p, base, o = {}) {
    const dmg = base * this.scale.dmg * (e.st.weaken > 0 ? 0.6 : 1);
    const dealt = this.hurtPlayer(p, dmg, o);
    e.atkT = 0.4;
    if (dealt > 0 && e.lifesteal) e.hp = Math.min(e.maxHp, e.hp + dealt * e.lifesteal);
    return dealt;
  }

  enemyAoe(e, x, y, r, base, o = {}) {
    for (const p of this.players.values()) {
      if (p.downed) continue;
      const rr = r + p.r;
      if (d2(p, { x, y }) < rr * rr) this.enemyHitPlayer(e, p, base, o);
    }
  }

  // Objetivo de un enemigo: aliados → hostiles; hostiles → señuelos de Loki o jugador visible.
  targetFor(e) {
    if (e.ally) {
      let best = null, bd = Infinity;
      for (const o of this.enemies) {
        if (o.dead || o.ally || o.spawning > 0) continue;
        const dd = d2(o, e);
        if (dd < bd) { bd = dd; best = o; }
      }
      return best;
    }
    let best = null, bd = Infinity;
    for (const d of this.decoys) {
      const dd = d2(d, e);
      if (dd < 520 * 520 && dd < bd) { bd = dd; best = d; }
    }
    if (best) return best;
    for (const p of this.players.values()) {
      if (p.downed || p.astral || p.invisT > 0) continue;
      const dd = d2(p, e);
      if (dd < bd) { bd = dd; best = p; }
    }
    return best;
  }

  updateEnemyEnt(e, dt) {
    if (e.dead) return;
    if (e.spawning > 0) { e.spawning -= dt; return; }
    if (e.hitFlash > 0) e.hitFlash -= dt;
    if (e.atkT > 0) e.atkT -= dt;
    this.tickStatuses(e, dt, false);
    if (e.dead) return;
    if (e.ally) {
      e.allyT -= dt;
      if (e.allyT <= 0) { this.fx.push({ k: 'boom', x: ri(e.x), y: ri(e.y), r: 30, c: '#ff4fa0' }); this.killEnemy(e, null, true); return; }
    }
    if (e.st.freeze > 0) return;
    e.spd = e.speed * (e.st.slow > 0 ? 0.5 : 1) * (this.gems.has('mente') && !e.ally ? 0.85 : 1) * (e.ally ? 1 : curses.enemySpeed(this));
    if (e.clone) e.def.updateClone(this, e, dt);
    else if (e.boss) e.def.update(this, e, dt);
    else updateEnemy(this, e, dt);
    this.clampToRoom(e);
  }

  killEnemy(e, src, silent = false) {
    if (e.dead) return;
    e.dead = true;
    e.hp = 0;
    this.fx.push({ k: 'boom', x: ri(e.x), y: ri(e.y), r: ri(e.r * 1.6), c: e.def.color });
    if (silent) return;
    if (e.illusion) { this.fx.push({ k: 'ring', x: ri(e.x), y: ri(e.y), r: 30, c: '#ff3b3b' }); return; }
    if (e.def.onDeath) e.def.onDeath(this, e);
    if (!e.ally && !e.clone) {
      this.stats.kills++;
      if (src && src.run) {
        src.run.kills++;
        src.soulDrain = false;   // "Hambre del Alma" termina al conseguir una baja
        if (src.def && src.def.onKill) src.def.onKill(this, src, e);   // p. ej. Moto Infernal
      }
      if (!e.boss && Math.random() < 0.06) this.spawnPickup('heart', e.x, e.y);
    }
  }

  separateEnemies() {
    const es = this.enemies;
    for (let i = 0; i < es.length; i++) {
      const a = es[i];
      if (a.dead) continue;
      for (let j = i + 1; j < es.length; j++) {
        const b = es[j];
        if (b.dead) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const min = a.r + b.r;
        const dd = dx * dx + dy * dy;
        if (dd >= min * min || dd < 0.0001) continue;
        const d = Math.sqrt(dd), push = (min - d) / 2, nx = dx / d, ny = dy / d;
        const wa = a.boss ? 0 : b.boss ? 2 : 1, wb = b.boss ? 0 : a.boss ? 2 : 1;
        a.x -= nx * push * wa; a.y -= ny * push * wa;
        b.x += nx * push * wb; b.y += ny * push * wb;
      }
    }
  }

  contactDamage(dt) {
    for (const e of this.enemies) {
      if (e.dead || e.spawning > 0 || e.st.freeze > 0 || e.def.noContact) continue;
      if (e.contactCd > 0) { e.contactCd -= dt; continue; }
      const base = (e.def.dmg || 10) * (e.contactBonus || 1);
      if (e.ally) {
        for (const o of this.enemies) {
          if (o.dead || o.ally || o.spawning > 0) continue;
          const rr = e.r + o.r + 4;
          if (d2(e, o) < rr * rr) { this.hurtEnemy(o, base * 1.5); e.contactCd = 0.6; break; }
        }
        continue;
      }
      for (const p of this.players.values()) {
        if (p.downed) continue;
        const rr = e.r + p.r;
        if (d2(e, p) < rr * rr) {
          const dealt = this.enemyHitPlayer(e, p, base * (e.illusion ? 0.4 : 1), { bleed: !!e.def.bleed, bleedDps: 5 * this.scale.dmg });
          if (dealt > 0) {
            e.contactCd = 0.7;
            if (e.def.bleed) this.fx.push({ k: 'slash', x: ri(p.x), y: ri(p.y), a: r2(Math.atan2(p.y - e.y, p.x - e.x)), r: 34, arc: 1.6, c: '#d01818', s: 'CrimsonSlash' });
          }
          break;
        }
      }
    }
  }

  // ───────────────────────── Proyectiles / zonas / señuelos ─────────────────────────
  updateProjs(dt) {
    const STEPS = 2, sdt = dt / STEPS;
    const c = this.cur;
    for (const pr of this.projs) {
      if (pr.dead) continue;
      pr.life -= dt;
      if (pr.life <= 0) { this.projExpire(pr); continue; }
      if (pr.homing && pr.side === 'p') {
        const t = this.nearestHostile(pr.x, pr.y, 520);
        if (t) {
          const want = Math.atan2(t.y - pr.y, t.x - pr.x);
          let cur = Math.atan2(pr.vy, pr.vx);
          cur += clamp(angDiff(want, cur), -pr.homing * dt, pr.homing * dt);
          const sp = Math.hypot(pr.vx, pr.vy);
          pr.vx = Math.cos(cur) * sp; pr.vy = Math.sin(cur) * sp;
        }
      }
      if (pr.boomerang) {
        pr.boomT -= dt;
        if (pr.boomT <= 0) {
          const o = this.players.get(pr.ownerId);
          if (!o) { pr.dead = true; continue; }
          if (!pr.returned) { pr.returned = true; pr.hit.clear(); }
          const a = Math.atan2(o.y - pr.y, o.x - pr.x), sp = Math.hypot(pr.vx, pr.vy);
          pr.vx = Math.cos(a) * sp; pr.vy = Math.sin(a) * sp;
          if (d2(o, pr) < 28 * 28) { pr.dead = true; continue; }
        }
      }
      for (let s = 0; s < STEPS && !pr.dead; s++) {
        pr.x += pr.vx * sdt;
        pr.y += pr.vy * sdt;
        if (pr.side === 'e' && (pr.bounces || 0) < 2 && curses.bounce(this) && (pr.x < 0 || pr.x > c.w || pr.y < 0 || pr.y > c.h)) {
          if (pr.x < 0 || pr.x > c.w) pr.vx = -pr.vx;
          if (pr.y < 0 || pr.y > c.h) pr.vy = -pr.vy;
          pr.x = clamp(pr.x, 0, c.w); pr.y = clamp(pr.y, 0, c.h);
          pr.bounces = (pr.bounces || 0) + 1;
          pr.life = Math.max(pr.life, 1.2);
        }
        if (pr.x < -20 || pr.y < -20 || pr.x > c.w + 20 || pr.y > c.h + 20) {
          if (pr.boomerang && !pr.returned) { pr.boomT = 0; pr.x = clamp(pr.x, 0, c.w); pr.y = clamp(pr.y, 0, c.h); }
          else { this.projExpire(pr); break; }
        }
        if (pr.side === 'p') {
          const owner = this.players.get(pr.ownerId) || null;
          for (const e of this.enemies) {
            if (e.dead || e.ally || e.spawning > 0 || pr.hit.has(e.id)) continue;
            const rr = e.r + pr.r;
            if (d2(e, pr) < rr * rr) {
              pr.hit.add(e.id);
              if (pr.explodeR) { this.explode(pr, owner); pr.dead = true; break; }
              this.hitEnemy(owner, e, pr.dmg, pr.o);
              if (pr.pierce-- <= 0) { pr.dead = true; break; }
            }
          }
        } else {
          for (const p of this.players.values()) {
            if (p.downed) continue;
            const rr = p.r + pr.r;
            if (d2(p, pr) < rr * rr) {
              const dealt = this.hurtPlayer(p, pr.dmg, pr.o);
              if (dealt > 0 && pr.o.heal) {
                const src = this.enemies.find((e) => e.id === pr.srcId);
                if (src && !src.dead) src.hp = Math.min(src.maxHp, src.hp + dealt * pr.o.heal);
              }
              if (dealt > 0 || !(p.invulnT > 0 || p.dashT > 0)) { pr.dead = true; break; }
            }
          }
        }
      }
    }
    this.projs = this.projs.filter((p) => !p.dead);
  }

  projExpire(pr) {
    if (pr.explodeR && pr.side === 'p') this.explode(pr, this.players.get(pr.ownerId) || null);
    pr.dead = true;
  }

  explode(pr, owner) {
    this.fx.push({ k: 'boom', x: ri(pr.x), y: ri(pr.y), r: pr.explodeR, c: pr.kind === 'webball' ? '#e8f0ff' : '#ff9a3a', s: pr.kind === 'gamma' ? 'SonicPulse' : pr.kind === 'webball' ? undefined : 'ExplosionBoom' });
    this.aoeEnemies(owner, pr.x, pr.y, pr.explodeR, pr.explodeDmg != null ? pr.explodeDmg : pr.dmg, pr.o);
  }

  // Zonas de peligro (círculos, haces giratorios, ataduras). dmg/dps se escalan por piso.
  spawnHazard(o) {
    const h = Object.assign({ id: nid(), kind: 'circle', delay: 0, dur: 0, dmg: 0, dps: 0, color: '#ff4040', angle: 0, angVel: 0, len: 0, width: 0 }, o);
    h.dmg *= this.scale.dmg;
    h.dps *= this.scale.dmg;
    h.delay0 = h.delay || 0.0001;
    this.hazards.push(h);
    return h;
  }

  // Zona de fuego del JUGADOR (rastro de la Moto Infernal): daña a los enemigos.
  spawnPlayerZone(p, x, y, o) {
    this.hazards.push({
      id: nid(), kind: 'pfire', side: 'p', ownerId: p.id, x, y, r: o.r, delay: 0, delay0: 0.0001,
      dur: o.dur, dmg: 0, dps: o.dps * this.dmgMultOf(p), color: o.color, angle: 0, angVel: 0, len: 0, width: 0,
    });
  }

  insideHazard(h, p) {
    if (h.kind === 'beam') {
      const c = Math.cos(h.angle), s = Math.sin(h.angle);
      const dx = p.x - h.x, dy = p.y - h.y;
      const t = dx * c + dy * s;
      return t > 0 && t < h.len && Math.abs(-dx * s + dy * c) < h.width / 2 + p.r;
    }
    const rr = h.r + p.r * 0.6;
    return d2(p, h) < rr * rr;
  }

  updateHazards(dt) {
    for (const h of this.hazards) {
      if (h.dead) continue;
      let src = null;
      if (h.follow) {
        src = this.enemies.find((e) => e.id === h.follow);
        if (!src || src.dead) { h.dead = true; continue; }
        h.x = src.x; h.y = src.y;
      }
      if (h.delay > 0) {
        h.delay -= dt;
        if (h.delay <= 0) {
          if (h.dmg) for (const p of this.players.values()) if (!p.downed && this.insideHazard(h, p)) this.hurtPlayer(p, h.dmg, {});
          if (h.boom) this.fx.push({ k: 'boom', x: ri(h.x), y: ri(h.y), r: ri(h.r), c: h.color });
          if (!h.dur) h.dead = true;
        }
        continue;
      }
      if (h.kind === 'beam') h.angle += h.angVel * dt;
      if (h.side === 'p') {
        const owner = this.players.get(h.ownerId) || null;
        for (const e of this.enemies) {
          if (e.dead || e.ally || e.spawning > 0) continue;
          const rr = h.r + e.r * 0.6;
          if (d2(e, h) < rr * rr) this.hurtEnemy(e, h.dps * dt, { silent: true, src: owner });
        }
      } else if (h.kind === 'tether') {
        const p = this.players.get(h.targetId);
        if (!p || p.downed || d2(p, h) > 560 * 560) { h.dead = true; continue; }
        h.tx = p.x; h.ty = p.y;
        const dealt = this.hurtPlayer(p, h.dps * dt, { hz: true });
        if (src && dealt > 0) src.hp = Math.min(src.maxHp, src.hp + dealt);
      } else if (h.dps) {
        for (const p of this.players.values()) if (!p.downed && this.insideHazard(h, p)) this.hurtPlayer(p, h.dps * dt, { hz: true });
      }
      h.dur -= dt;
      if (h.dur <= 0) h.dead = true;
    }
    this.hazards = this.hazards.filter((h) => !h.dead);
  }

  updateDecoys(dt) {
    for (const d of this.decoys) {
      d.life -= dt;
      if (d.life <= 0) {
        d.dead = true;
        this.fx.push({ k: 'boom', x: ri(d.x), y: ri(d.y), r: d.r, c: '#5fe08a' });
        this.aoeEnemies(this.players.get(d.ownerId) || null, d.x, d.y, d.r, d.dmg, {});
      }
    }
    this.decoys = this.decoys.filter((d) => !d.dead);
  }

  // ───────────────────────── Botín ─────────────────────────
  spawnPickup(kind, x, y, extra = {}) {
    const k = Object.assign({ id: nid(), kind, x, y, t: this.time }, extra);
    // Cofre: aspecto según su calidad (chests.png → tecnológico / dorado / cósmico).
    if (kind === 'chest') k.tier = k.rarity === 'legendary' ? 'cosmic' : (k.bonus || 0) >= 0.08 ? 'gold' : 'tech';
    this.pickups.push(k);
    return k;
  }

  updatePickups() {
    for (const k of this.pickups) {
      if (k.dead || this.time - k.t < 0.5) continue;
      for (const p of this.players.values()) {
        if (p.downed) continue;
        const rr = p.r + 20;
        if (d2(p, k) > rr * rr) continue;
        if (k.kind === 'heart') { if (p.hp >= p.maxHp) continue; this.healPlayer(p, p.maxHp * 0.25); this.fxText(p.x, p.y - 30, '+Vida', '#ff7a9a'); }
        else if (k.kind === 'chest') this.openChest(p, k);
        else if (k.kind === 'item') {
          if (k.lockId === p.id && this.time < k.lockT) continue;
          if (p.items.length >= MAX_ITEMS) {
            if (this.time > (p.fullHintT || 0)) { p.fullHintT = this.time + 2.5; this.fxText(p.x, p.y - 50, `Inventario lleno (${MAX_ITEMS}) — pulsa G para soltar`, '#ff9a9a'); }
            continue;
          }
          if (!this.giveItem(p, k.itemId)) continue;
        }
        else if (k.kind === 'gem') this.giveGem(k.gem, p);
        else if (k.kind === 'iso') { p.run.isoBonus = (p.run.isoBonus || 0) + (k.amount || 10); this.fxText(p.x, p.y - 40, `+${k.amount || 10} Iso-8`, '#e59aff'); this.fx.push({ k: 'sfx', s: 'coin', x: ri(p.x), y: ri(p.y) }); }
        k.dead = true;
        break;
      }
    }
    this.pickups = this.pickups.filter((k) => !k.dead);
  }

  openChest(p, k) {
    const n = 1 + (p.def.extraChest ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const id = rollItem(p.luck + (k.bonus || 0), k.rarity || null);
      this.spawnPickup('item', k.x + (i - (n - 1) / 2) * 46, k.y + 12, { itemId: id, rarity: ITEMS[id].rarity });
    }
    this.fx.push({ k: 'boom', x: ri(k.x), y: ri(k.y), r: 40, c: '#ffd76a' });
    this.fx.push({ k: 'chest', x: ri(k.x), y: ri(k.y), tier: k.tier || 'tech' });
    this.fx.push({ k: 'sfx', s: 'chest', x: ri(k.x), y: ri(k.y) });
    if (p.def.extraChest) this.fxText(k.x, k.y - 34, '¡Suerte de Loki! +1 ítem', '#7fdc8a');
  }

  giveItem(p, id) {
    const it = ITEMS[id];
    if (!it || p.items.length >= MAX_ITEMS) return false;
    p.items.push(id);
    p.lastPick = id;
    this.recalc(p);
    if (it.onPick === 'healFull') p.hp = p.maxHp;
    if (it.mods && it.mods.shield) p.shield = p.shieldMax;   // el escudo llega cargado
    // Efecto visible: texto flotante, brillo del color del ítem, sonido y aviso con icono.
    p.pickT = 1.6;
    p.pickC = it.aura || RARITY_COLOR[it.rarity];
    this.fxText(p.x, p.y - 46, shortEffect(it), RARITY_COLOR[it.rarity]);
    this.fx.push({ k: 'ring', x: ri(p.x), y: ri(p.y), r: 60, c: RARITY_COLOR[it.rarity] });
    this.fx.push({ k: 'sfx', s: 'coin', x: ri(p.x), y: ri(p.y) });
    this.toast(`${p.name} obtuvo ${it.name} — ${it.desc}`, RARITY_COLOR[it.rarity]);
    p.client.conn.send(JSON.stringify({ t: 'inv', items: p.items }));
    p.client.conn.send(JSON.stringify({ t: 'got', id }));
    unlocks.onItemPicked(this, p, it);
    if (p.def.onItem) p.def.onItem(this, p, it, id);   // evoluciones (Hulk-Buster, Fuego Azul)
    return true;
  }

  giveGem(g, p) {
    if (this.gems.has(g)) return;
    this.gems.add(g);
    for (const q of this.players.values()) this.recalc(q);
    this.fx.push({ k: 'ring', x: ri(p.x), y: ri(p.y), r: 260, c: GEMS[g].color });
    this.toast(`💎 ¡${GEMS[g].name}! (${this.gems.size}/6) — ${GEMS[g].buff}${this.gems.size < 6 ? ' · ⚠ más riesgo de Sobrecarga Cósmica' : ''}`, GEMS[g].color);
    unlocks.onGemCollected(this);
    if (this.gems.size === 6) this.activateGauntlet();
  }

  // Las 6 gemas: Poder del Guantelete (buff masivo, aura multicolor) y fin de las maldiciones.
  activateGauntlet() {
    if (this.gauntlet) return;
    this.gauntlet = true;
    curses.end(this);
    for (const q of this.players.values()) {
      this.recalc(q);
      q.hp = q.maxHp;
      this.fx.push({ k: 'ring', x: ri(q.x), y: ri(q.y), r: 320, c: '#ffd76a', s: 'StrangeUlti' });
    }
    this.fx.push({ k: 'sfx', s: 'ult', x: 0, y: 0 });
    this.toast('✊ ¡PODER DEL GUANTELETE! +50% daño, +15% velocidad, −25% enfriamientos y fin de la Sobrecarga Cósmica', '#ffd76a');
  }

  randomMissingGem() {
    const miss = GEM_ORDER.filter((g) => !this.gems.has(g));
    return miss.length ? miss[Math.floor(Math.random() * miss.length)] : null;
  }

  // Recompensa de reto (desafío, jefes dobles, sala secreta): gema que falte o cofre legendario.
  rewardGem(x, y, why) {
    const g = this.randomMissingGem();
    if (g) { this.spawnPickup('gem', x, y, { gem: g }); this.toast(`💎 ${why}: ¡aparece una Gema del Infinito!`, GEMS[g].color); }
    else this.spawnPickup('chest', x, y, { rarity: 'legendary' });
  }

  // ── Goblin Saqueador ──
  // Huida: se escapa por un portal a una sala vecina (se le puede perseguir). Si vuelve a huir, el ítem se pierde.
  goblinEscape(e) {
    const it = ITEMS[e.stolen];
    this.fx.push({ k: 'ring', x: ri(e.x), y: ri(e.y), r: 60, c: '#9a5aff', s: 'VoidPortal' });
    if (!e.stolen) { this.killEnemy(e, null, true); return; }
    const opts = neighbors(this.floor, this.cur.id).filter((id) => id[0] === 'm' || this.roomState.has(id));
    if (!e.chased && opts.length) {
      const room = opts[Math.floor(Math.random() * opts.length)];
      this.goblinChase = { room, itemId: e.stolen };
      this.toast(`💰 ¡El Goblin huye con ${it ? it.name : 'tu ítem'} a otra sala! Síguelo por el portal (minimapa)`, '#c08aff');
    } else this.toast(`💨 El Goblin ha escapado con ${it ? it.name : 'tu ítem'}...`, '#ff9a9a');
    e.stolen = null;
    this.killEnemy(e, null, true);
    this.sendMap();
  }

  // ───────────────────────── Desbloqueos persistentes ─────────────────────────
  unlock(p, charId, reason) {
    if (!p || !p.profile || p.profile.unlocked[charId] || !CHARS[charId]) return;
    p.profile.unlocked[charId] = true;
    profiles.save();
    p.client.conn.send(JSON.stringify({ t: 'unlock', id: charId, reason }));
    this.toast(`🔓 ${p.name} ha desbloqueado a ${CHARS[charId].name}: ${reason}`, '#7fffb0');
  }

  // ───────────────────────── Pisos y salas ─────────────────────────
  // Minimapa: salas del piso (principales en fila, ramas arriba/abajo), visitadas/despejadas,
  // actual, salidas abiertas (portales) y sala a la que huyó el Goblin.
  mapData() {
    const f = this.floor, c = this.cur;
    const rooms = f.main.map((r, i) => ({ id: r.id, k: r.type === 'boss' ? (r.bosses.length > 1 ? 'boss2' : 'boss') : 'combat', x: i, y: 0, am: r.ambush && this.visited.has(r.id) ? 1 : 0 }));
    for (const [idx, list] of Object.entries(f.branches)) {
      list.forEach((kind, j) => rooms.push({ id: `b${idx}${kind}`, k: kind, x: Number(idx), y: j === 0 ? -1 : 1 }));
    }
    const sIdx = f.main.findIndex((r) => r.secret);
    if (sIdx >= 0 && (this.secretShown || this.visited.has(`b${sIdx}secret`))) {
      const taken = rooms.some((r) => r.x === sIdx && r.y === 1);
      rooms.push({ id: `b${sIdx}secret`, k: 'secret', x: sIdx, y: taken ? 2 : 1 });
    }
    for (const r of rooms) { r.v = this.visited.has(r.id) ? 1 : 0; r.cl = this.roomState.has(r.id) || (c.id === r.id && c.cleared) ? 1 : 0; }
    const exits = c.cleared ? c.doors.filter((d) => !d.hidden).map((d) => d.target || d.kind) : [];
    return { t: 'map', fl: this.floorNum, name: this.floorDef.name, rooms, cur: c.id, exits, goblin: this.goblinChase ? this.goblinChase.room : null };
  }

  sendMap() { if (this.cur && this.floor) this.room.broadcastRun(this.mapData()); }

  loadFloor(n) {
    if (this.goblinChase) { this.toast('💨 El Goblin y su botín se quedan atrás...', '#ff9a9a'); this.goblinChase = null; }
    curses.end(this);
    this.floorNum = n;
    this.visited = new Set();
    this.roomState = new Map();
    this.branchSpecs = {};
    this.goblinFloor = false;
    this.secretShown = false;
    const np = this.players.size;
    this.floor = genFloor(n, np, n === this.secretFloor, this.bossPlan);
    this.floorDef = this.floor.def;
    this.scale = { hp: (1 + 0.35 * (n - 1)) * (1 + 0.55 * (np - 1)), dmg: 1 + 0.18 * (n - 1) };
    this.bossHpScale = BOSS_HP_SCALE[Math.min(4, Math.max(1, np))] * (1 + 0.1 * (n - 1));
    for (const p of this.players.values()) { p.run.floorStart = this.time; p.run.floorHit = false; }
    const names = this.floorDef.bosses.map((b) => BOSSES[b].name).join(' y ');
    this.toast(`Piso ${n}: ${this.floorDef.name} — os ${this.floorDef.bosses.length > 1 ? 'esperan' : 'espera'} ${names}`, '#ffd76a');
    this.enterRoom(this.floor.main[0], 'left');
  }

  // Especificación de una sala por id (las ramas se generan una vez por piso).
  roomSpec(id) {
    if (id[0] === 'm') return this.floor.main[Number(id.slice(1))];
    if (!this.branchSpecs[id]) {
      const i = Number(id[1]), kind = id.slice(2);
      this.branchSpecs[id] = branchSpec(kind, this.floorNum, this.players.size, this.floorDef, i);
    }
    return this.branchSpecs[id];
  }

  // Al salir de una sala despejada se guarda su botín para poder volver (portales bidireccionales).
  saveRoom() {
    const c = this.cur;
    if (!c || !c.cleared) return;
    this.roomState.set(c.id, { pickups: this.pickups.filter((k) => !k.dead) });
  }

  enterRoom(spec, from = 'left') {
    const id = spec.id;
    const isBranch = id[0] === 'b', mainIndex = Number(id[1]);
    const saved = this.roomState.get(id);
    const c = this.cur = Object.assign({}, spec, {
      mainIndex, isBranch, waveIdx: -1, waveDelay: spec.ambush ? 0.5 : 0.9, cleared: false, doors: [], bossSpawned: false, bossDelay: 1.6,
      doorGrace: 1.0, timer: spec.timeLimit || 0, timerOn: false, failed: false,
    });
    this.enemies = []; this.projs = []; this.hazards = []; this.pickups = []; this.decoys = []; this.sched = [];
    this.pull = null; this.bossId = 0; this.bossIds = [];
    curses.end(this);
    const ps = [...this.players.values()];
    ps.forEach((p, i) => {
      p.x = from === 'right' ? c.w - 170 : 170;   // fuera del portal por el que se llega
      p.y = c.h / 2 + (i - (ps.length - 1) / 2) * 50;
      p.dashT = 0;
      p.st = {};
      p.stunT = 0;
      p.invulnT = 1.2;
      if (p.downed) { p.downed = false; p.hp = p.maxHp * 0.3; p.revive = 0; p.downT = 0; }
      if (p.astral) this.endAstral(p);
    });
    if (saved) {
      c.cleared = true;
      this.pickups = saved.pickups;
      for (const k of this.pickups) k.t = this.time - 1;
      this.makeDoors();
      this.toast(`${c.name} (despejada)`, '#9fb4e0');
    } else if (c.type === 'treasure') {
      const n = ps.length + 1;
      for (let i = 0; i < n; i++) this.spawnPickup('chest', c.w / 2 + (i - (n - 1) / 2) * 110, c.h / 2, { bonus: 0.08 });
      c.cleared = true;
      this.makeDoors();
    }
    if (!saved) {
      if (c.type === 'boss') this.toast(`⚠ ${c.bosses.map((b) => `${BOSSES[b].name} — ${BOSSES[b].title}`).join('  ·  ')}`, '#ff6464');
      else if (c.type === 'challenge') this.toast(`⏱ Desafío: despeja las oleadas en ${c.timeLimit} s para ganar una Gema del Infinito`, '#ff5aa0');
      else if (c.type === 'secret') this.toast('✨ Sala Secreta: sobrevive a la élite y reclama una Gema del Infinito', '#c070ff');
      else if (c.type !== 'treasure') this.toast(c.name, '#cfd8ff');
      if (!c.cleared) curses.roll(this);   // Sobrecarga Cósmica al entrar en combate
    }
    // Goblin perseguido: aparece en esta sala con el ítem robado e intenta huir de nuevo.
    if (this.goblinChase && this.goblinChase.room === id) {
      const g = this.goblinChase;
      this.goblinChase = null;
      const e = this.spawnEnemy('goblin', from === 'right' ? 200 : c.w - 200, c.h / 2 + (Math.random() - 0.5) * 200, { noSpawnAnim: true });
      e.stolen = g.itemId; e.chased = true; e.ai.state = 'flee'; e.ai.fleeT = 12;
      this.toast('💰 ¡Ahí está el Goblin! Acaba con él antes de que vuelva a escapar', '#c08aff');
    }
    this.visited.add(id);
    // Sinergia "escudo inicial": el escudo se rellena al entrar en cada sala.
    if (this.synergies.some((sy) => SYN[sy].shieldOnEnter)) for (const p of this.players.values()) p.shield = p.shieldMax;
    this.sendMap();
  }

  // Oleada; en salas de emboscada aparece en anillo alrededor del equipo.
  spawnWave(list, elite, ambush = false) {
    const alive = this.alivePlayers();
    const cx = alive.length ? alive.reduce((a, p) => a + p.x, 0) / alive.length : this.cur.w / 2;
    const cy = alive.length ? alive.reduce((a, p) => a + p.y, 0) / alive.length : this.cur.h / 2;
    list.forEach((type, k) => {
      let pos;
      if (ambush) {
        const a = (k / list.length) * TAU + Math.random() * 0.4, rr = 190 + Math.random() * 70;
        pos = { x: clamp(cx + Math.cos(a) * rr, 60, this.cur.w - 60), y: clamp(cy + Math.sin(a) * rr, 60, this.cur.h - 60) };
      } else pos = this.freeSpot(280);
      const n = (ENEMIES[type] && ENEMIES[type].group) || 1;   // enjambres (Mini-Ultron)
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        this.spawnEnemy(type, pos.x + (n > 1 ? Math.cos(a) * 34 : 0), pos.y + (n > 1 ? Math.sin(a) * 34 : 0), { elite: elite || (ambush && k === 0) });
      }
    });
  }

  updateRoomLogic(dt) {
    const c = this.cur;
    if (this.transition) return;
    if (c.doorGrace > 0) c.doorGrace -= dt;
    if (c.cleared) { if (c.doorGrace <= 0) this.checkDoors(); return; }
    if (c.type === 'boss') {
      if (!c.bossSpawned) {
        c.bossDelay -= dt;
        if (c.bossDelay <= 0) {
          c.bossSpawned = true;
          const n = c.bosses.length;
          c.bosses.forEach((b, i) => {
            const e = this.spawnEnemy(b, c.w * (n > 1 ? 0.33 + i * 0.34 : 0.5), c.h * 0.32, { noSpawnAnim: true, hpMult: n > 1 ? DOUBLE_BOSS_HP : 1 });
            this.bossIds.push(e.id);
            this.fx.push({ k: 'ring', x: ri(e.x), y: ri(e.y), r: 200, c: e.def.color });
          });
          this.bossId = this.bossIds[0];
          if (n > 1) this.toast('⚠⚠ ¡JEFES DOBLES! Derrotad a los dos', '#ff4040');
        }
        return;
      }
      const alive = this.bossIds.filter((id) => this.enemies.some((e) => e.id === id && !e.dead));
      this.bossId = alive[0] || 0;
      if (!alive.length) this.clearRoom();
      return;
    }
    // Desafío cronometrado
    if (c.type === 'challenge' && c.timerOn && !c.failed) {
      c.timer -= dt;
      if (c.timer <= 0) { c.timer = 0; c.failed = true; this.toast('⏱ ¡Tiempo agotado! El desafío ya no dará gema', '#ff8080'); }
    }
    if (!this.enemies.some((e) => !e.dead && !e.ally && !e.illusion)) {
      if (c.waveIdx + 1 < c.waves.length) {
        c.waveDelay -= dt;
        if (c.waveDelay <= 0) {
          c.waveIdx++;
          if (c.ambush && c.waveIdx === 0) { this.toast('⚠ ¡EMBOSCADA!', '#ff4040'); this.fx.push({ k: 'shake', s: 8, p: 0 }); }
          this.spawnWave(c.waves[c.waveIdx], !!c.elite, !!c.ambush);
          if (c.type === 'challenge') c.timerOn = true;
          // Goblin Saqueador: acompaña a la 1ª oleada si alguien lleva ítems (máx. 1 por piso).
          if (c.waveIdx === 0 && c.type === 'combat' && !this.goblinFloor && Math.random() < GOBLIN_CHANCE
            && [...this.players.values()].some((p) => p.items.length)) {
            this.goblinFloor = true;
            const pos = this.freeSpot(320);
            this.spawnEnemy('goblin', pos.x, pos.y);
            this.toast('💰 ¡Un Goblin Saqueador! Protege tu inventario', '#c08aff');
          }
          c.waveDelay = c.ambush ? 0.6 : 1.2;
        }
      } else this.clearRoom();
    }
  }

  clearRoom() {
    const c = this.cur;
    c.cleared = true;
    this.stats.roomsCleared++;
    for (const e of this.enemies) if (!e.dead) this.killEnemy(e, null, true);
    this.projs = this.projs.filter((p) => p.side === 'p');
    this.hazards = [];
    this.pull = null;
    this.sched = [];
    curses.end(this);
    for (const p of this.players.values()) unlocks.onRoomCleared(this, p);
    // Limpiar la sala devuelve a los jugadores en Forma Astral.
    for (const p of this.players.values()) if (p.astral) this.endAstral(p);

    const cx = c.w / 2, cy = c.h / 2;
    if (c.type === 'combat') {
      if (Math.random() < 0.35) this.spawnPickup('chest', cx, cy);
      this.toast(c.ambush ? '¡Emboscada superada!' : '¡Sala despejada!', '#9fffb0');
      if (c.ambush) this.spawnPickup('chest', cx + 60, cy, { bonus: 0.1 });
    } else if (c.type === 'vault') {
      if (Math.random() < 0.35) this.rewardGem(cx, cy, 'La Bóveda guardaba un tesoro');
      else this.spawnPickup('chest', cx, cy, { rarity: 'legendary' });
      this.toast('¡Bóveda abierta!', '#5aa0ff');
    } else if (c.type === 'challenge') {
      if (!c.failed) this.rewardGem(cx, cy, `Desafío superado con ${Math.ceil(c.timer)} s de margen`);
      else this.spawnPickup('chest', cx, cy, { bonus: 0.1 });
    } else if (c.type === 'secret') {
      this.rewardGem(cx, cy, 'Sala Secreta superada');
      this.stats.secretBoss = true;
      unlocks.onSecretBossDefeated(this);
    } else if (c.type === 'boss') {
      const n = c.bosses.length;
      this.stats.bosses += n;
      this.spawnPickup('chest', cx - 90, cy + 60, { bonus: 0.15 });
      for (const p of this.players.values()) this.spawnPickup('heart', cx + 90 + Math.random() * 60, cy + 60 + Math.random() * 60);
      this.toast(`¡${c.bosses.map((b) => BOSSES[b].name).join(' y ')} ${n > 1 ? 'derrotados' : 'derrotado'}!`, '#ffd76a');
      for (const b of c.bosses) unlocks.onBossDefeated(this, b);
      if (n > 1) {
        this.stats.doubleBosses++;
        this.rewardGem(cx, cy - 40, 'Jefes dobles derrotados');
        this.spawnPickup('chest', cx + 90, cy + 60, { bonus: 0.2 });
        unlocks.onDoubleBoss(this);
      }
      for (const p of this.players.values()) unlocks.onFloorCleared(this, p);
    }
    this.makeDoors();
    this.sendMap();
  }

  // Portales bidireccionales según las conexiones reales del minimapa.
  makeDoors() {
    const c = this.cur, f = this.floor;
    const doors = [];
    const add = (kind, label, x, y, extra = {}) => doors.push(Object.assign({ id: nid(), kind, label, x, y, w: 110, h: 110, count: 0 }, extra));
    const ex = c.w - 70, lx = 70, ey = c.h / 2;
    const done = (id) => (this.roomState.has(id) ? ' ✔' : '');
    if (c.type === 'boss') {
      if (this.floorDef.last) add('victory', '¡Victoria! Terminar la run', ex, ey);
      else add('floor', `Bajar al piso ${this.floorNum + 1}`, ex, ey);
      add('back', '← Sala 3', lx, ey, { target: 'm2' });
    } else if (c.isBranch) {
      add('back', `← Sala ${c.mainIndex + 1}`, lx, ey, { target: `m${c.mainIndex}` });
    } else {
      const i = c.mainIndex, next = f.main[i + 1];
      add('next', next.type === 'boss' ? '⚠ Arena del jefe' : `Sala ${i + 2}${done(next.id)}`, ex, ey, { target: next.id });
      if (i > 0) add('back', `← Sala ${i}`, lx, ey, { target: f.main[i - 1].id });
      const br = f.branches[i] || [];
      const LABEL = { treasure: 'Sala del Tesoro', vault: 'Bóveda (custodiada)', challenge: 'Desafío ⏱ (gema)' };
      br.forEach((b, j) => {
        const id = `b${i}${b}`;
        add(b, LABEL[b] + done(id), c.w / 2 + (br.length > 1 ? (j ? 170 : -170) : 0), j % 2 ? c.h - 70 : 70, { target: id });
      });
      if (c.secret) add('secret', 'Sala Secreta', 220 + Math.random() * 200, c.h - 70, { hidden: !this.secretShown, target: `b${i}secret` });
    }
    c.doors = doors;
  }

  checkDoors() {
    const c = this.cur;
    const alive = this.alivePlayers();
    if (!alive.length) return;
    for (const d of c.doors) {
      if (d.hidden) {
        if (alive.some((p) => d2(p, d) < 150 * 150)) {
          d.hidden = false;
          this.stats.secretFound = true;
          this.secretShown = true;
          this.sendMap();
          this.toast('✨ ¡Una ilusión se desvanece... has encontrado la Sala Secreta!', '#c070ff');
          this.fx.push({ k: 'ring', x: ri(d.x), y: ri(d.y), r: 120, c: '#c070ff' });
        } else continue;
      }
      d.count = alive.filter((p) => Math.abs(p.x - d.x) < d.w / 2 && Math.abs(p.y - d.y) < d.h / 2).length;
      if (d.count === alive.length) { this.transition = { t: 0.6, door: d }; this.fx.push({ k: 'flash' }); break; }
    }
  }

  doTransition(d) {
    this.saveRoom();
    switch (d.kind) {
      case 'next': case 'back': case 'treasure': case 'vault': case 'challenge': case 'secret':
        this.enterRoom(this.roomSpec(d.target), d.kind === 'back' ? 'right' : 'left');
        break;
      case 'floor': this.loadFloor(this.floorNum + 1); break;
      case 'victory': this.endRun(true); break;
      default: break;
    }
  }

  checkLose() {
    const ps = [...this.players.values()];
    // Derrota si no queda nadie activo (todos caídos o en Forma Astral).
    if (ps.length && ps.every((p) => p.downed || p.astral)) this.endRun(false);
  }

  endAstral(p) {
    p.astral = false;
    p.hp = Math.max(1, p.maxHp * 0.3);
    p.invulnT = 1.5;
    this.fx.push({ k: 'ring', x: ri(p.x), y: ri(p.y), r: 70, c: '#7fff9a' });
    this.fxText(p.x, p.y - 30, '¡De vuelta al plano físico!', '#7fff9a');
  }

  endRun(win) {
    if (this.over) return;
    this.over = true;
    const s = this.stats;
    const trueWin = win && this.gauntlet;   // victoria con el Guantelete completo
    const base = s.roomsCleared * 8 + s.bosses * 40 + (this.floorNum - 1) * 20 + (win ? 150 : 0) + (trueWin ? 300 : 0);
    this.result = {
      win, trueWin, floor: this.floorNum, floorName: this.floorDef.name,
      roomsCleared: s.roomsCleared, bosses: s.bosses, kills: s.kills, gems: [...this.gems], secretBoss: s.secretBoss,
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, charId: p.charId, iso: base + p.run.kills + (p.run.isoBonus || 0),
        kills: p.run.kills, dealt: Math.round(p.run.dealt), taken: Math.round(p.run.damageTaken), items: p.items.length,
      })),
    };
  }

  // ───────────────────────── Utilidades ─────────────────────────
  clampToRoom(ent) {
    const c = this.cur;
    ent.x = clamp(ent.x, ent.r, c.w - ent.r);
    ent.y = clamp(ent.y, ent.r, c.h - ent.r);
  }

  schedule(t, fn) { this.sched.push({ t, fn }); }
  fxText(x, y, s, c) { this.fx.push({ k: 'text', x: ri(x), y: ri(y), s, c }); }
  toast(text, c = '#ffffff') { this.room.broadcastRun({ t: 'toast', text, c }); }

  // ───────────────────────── Bucle principal ─────────────────────────
  // Solo existe y se simula la sala ACTIVA (donde están los jugadores): las demás salas del piso
  // se guardan como datos (roomState: botín en el suelo) y no ejecutan IA, físicas ni colisiones.
  update(dt) {
    if (this.over || !this.players.size) return;
    this.time += dt;
    for (let i = this.sched.length - 1; i >= 0; i--) {
      const s = this.sched[i];
      s.t -= dt;
      if (s.t <= 0) { this.sched.splice(i, 1); s.fn(); }
    }
    if (this.transition) {
      this.transition.t -= dt;
      if (this.transition.t <= 0) {
        const d = this.transition.door;
        this.transition = null;
        this.doTransition(d);
        if (this.over) return;
      }
    }
    for (const p of this.players.values()) this.updatePlayer(p, dt);
    if (this.pull) { this.pull.t -= dt; if (this.pull.t <= 0) this.pull = null; }
    for (const e of this.enemies) this.updateEnemyEnt(e, dt);
    this.separateEnemies();
    this.updateProjs(dt);
    this.updateHazards(dt);
    this.updateDecoys(dt);
    this.updatePickups();
    this.contactDamage(dt);
    curses.update(this, dt);
    this.enemies = this.enemies.filter((e) => !e.dead);
    this.updateRoomLogic(dt);
    this.checkLose();
  }

  snapshot() {
    const c = this.cur;
    const key = this.snapN = (this.snapN || 0) + 1;
    const full = key % KEYFRAME === 1;
    if (!this.netLast) this.netLast = { p: new Map() };
    const last = this.netLast;
    const P = [];
    for (const p of this.players.values()) {
      const def = p.def;
      P.push({
        i: p.id, n: p.name, c: p.charId, x: ri(p.x), y: ri(p.y), a: r2(p.aim),
        hp: Math.ceil(p.hp), mh: p.maxHp, dn: p.downed ? 1 : 0, rv: r2(p.revive / REVIVE_TIME),
        dt: p.downed ? r2(Math.max(0, ASTRAL_AFTER - p.downT)) : 0, as: p.astral ? 1 : 0, r: p.r,
        fm: p.form || '', ak: p.atkT > 0 ? 1 : 0, rf: p.input.revive ? 1 : 0,
        ft: r2(p.form === 'banner' ? p.bannerT : p.bikeT > 0 ? p.bikeT : 0), bk: p.bikeKills || 0,
        iv: p.invisT > 0 ? 1 : 0, ds: p.dashT > 0 ? 1 : 0, gd: p.invulnT > 0 ? 1 : 0,
        m: p.mode === 'stealth' ? 1 : 0, bz: p.berserk ? 1 : 0, ur: p.usedRevive ? 1 : 0, av: p.buffs.avengers > 0 ? 1 : 0,
        st: this.statusBits(p),
        sh: Math.ceil(p.shield), sm: p.shieldMax, sn: p.stunT > 0 ? 1 : 0,
        au: p.auras, pk: p.pickT > 0 ? p.pickC : 0, dr: p.items.includes('SpyDrone') ? 1 : 0, sd: p.soulDrain ? 1 : 0,
        cd: [r2(Math.max(0, p.cd.dash)), r2(Math.max(0, p.cd.ab)), r2(Math.max(0, p.cd.ult))],
        cm: [r2(DASH_CD * p.dashCdMult), r2(def.abilityCd * (def.fixedAbilityCd ? 1 : p.cdMult)), def.ult ? r2(def.ultCd * p.cdMult) : 0],
      });
      const o = P[P.length - 1];
      const sk = JSON.stringify(P_STATIC.map((k) => o[k]));
      if (!full && last.p.get(p.id) === sk) for (const k of P_STATIC) delete o[k];
      else last.p.set(p.id, sk);
    }
    const E = [];
    for (const e of this.enemies) {
      if (e.dead) continue;
      let f = this.statusBits(e);
      if (e.ally) f |= 128;
      if (e.boss) f |= 256;
      if (e.field) f |= 512;
      if (e.spawning > 0) f |= 1024;
      if (e.elite) f |= 2048;
      if (e.charging) f |= 4096;
      if (e.hitFlash > 0) f |= 8192;
      if (e.atkT > 0) f |= 16384;
      if (e.stunned) f |= 32768;
      if (e.illusion) f |= 65536;
      E.push([e.id, e.type, ri(e.x), ri(e.y), Math.ceil(e.hp), Math.ceil(e.maxHp), ri(e.r), f, r2(e.face || 0), e.anim || '', e.stolen || '']);
    }
    const R = this.projs.map((p) => [p.id, ri(p.x), ri(p.y), p.r, p.kind, p.side === 'p' ? 1 : 0, r2(Math.atan2(p.vy, p.vx))]);
    const H = this.hazards.map((h) => [h.id, h.kind, ri(h.x), ri(h.y), ri(h.r || 0), h.delay > 0 ? r2(h.delay / h.delay0) : 0, h.color, r2(h.angle), ri(h.len), ri(h.width), ri(h.tx || 0), ri(h.ty || 0)]);
    const K = this.pickups.map((k) => [k.id, k.kind, ri(k.x), ri(k.y), k.itemId || k.gem || '', k.kind === 'chest' ? k.tier : k.rarity || '']);
    for (const d of this.decoys) K.push([d.id, 'decoy', ri(d.x), ri(d.y), d.charId, r2(d.aim)]);
    const D = c.doors.map((d) => [d.id, ri(d.x), ri(d.y), d.w, d.h, d.kind, d.label, d.count || 0, d.hidden ? 1 : 0]);
    // Parte estática de la sala, portales y datos del equipo: solo si cambian (o en keyframe).
    const rs = { ty: c.type, w: c.w, h: c.h, th: c.theme, ac: c.accent, bg: c.stage || '', tn: c.tint || '', nm: c.name, fl: this.floorNum, am: c.ambush ? 1 : 0 };
    const meta = { gems: [...this.gems], bs: this.bossIds, sy: this.synergies, gt: this.gauntlet ? 1 : 0 };
    const msg = {
      t: 's',
      room: { cl: c.cleared ? 1 : 0, wv: [c.waveIdx + 1, c.waves ? c.waves.length : 0], tr: this.transition ? 1 : 0, ct: c.type === 'challenge' ? r2(c.timer) : 0, cf: c.failed ? 1 : 0 },
      boss: this.bossId, cu: this.curse ? [this.curse.g, r2(this.curse.t)] : 0, pull: this.pull ? [ri(this.pull.x), ri(this.pull.y)] : 0,
      P, E, R, H, K, F: this.fx,
    };
    const diff = (name, val) => { const s = JSON.stringify(val); if (full || last[name] !== s) { last[name] = s; msg[name] = val; } };
    diff('rs', rs);
    diff('D', D);
    diff('meta', meta);
    if (full) msg.kf = 1;
    const out = JSON.stringify(msg);
    this.fx = [];
    return out;
  }
}

module.exports = { World };
