'use strict';
// ══════════ Jefes ══════════
// En rotación (con sprite real): Juggernaut, Ultrón, Magneto y Carnage (ver floors.js).
// Thanos, Dormammu, Loki y Galactus siguen definidos pero NO se generan (sin sprite).
// Piso 1 Magneto · Piso 2 Carnage · Piso 3 Dormammu · Piso 4 Thanos
// Secreto: Loki (Sala Secreta del Engaño) · Final verdadero: Galactus (requiere las 6 gemas)
// Todos combaten en arenas grandes con oleadas de refuerzos.
const { GEMS, GEM_ORDER } = require('./gems');

const TAU = Math.PI * 2;
const R = Math.random;
const pick = (a) => a[Math.floor(R() * a.length)];
const d2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };
const aimAt = (e, t) => Math.atan2(t.y - e.y, t.x - e.x);

function moveTo(e, x, y, spd, dt) {
  const dx = x - e.x, dy = y - e.y, d = Math.hypot(dx, dy);
  if (d > 1) { const s = Math.min(d, spd * dt); e.x += (dx / d) * s; e.y += (dy / d) * s; }
  return d;
}
function radial(w, e, n, o, off = 0) { for (let i = 0; i < n; i++) w.enemyShoot(e, off + (i / n) * TAU, o); }
// Ejecuta fn tras t segundos solo si el jefe sigue vivo.
function later(w, e, t, fn) { w.schedule(t, () => { if (!e.dead) fn(); }); }
// Refuerzos al cruzar umbrales de vida.
function thresholdAdds(w, e, thr, type, count) {
  e.ai.addsDone = e.ai.addsDone || {};
  for (const t of thr) {
    if (!e.ai.addsDone[t] && e.hp < e.maxHp * t) {
      e.ai.addsDone[t] = true;
      w.spawnAdds(type, count);
      w.toast('¡Oleada de refuerzos!', '#ffb060');
    }
  }
}
// Refuerzos periódicos con tope de enemigos vivos.
function timedAdds(w, e, dt, every, type, count, maxAlive) {
  e.ai.addT = (e.ai.addT == null ? every : e.ai.addT) - dt;
  if (e.ai.addT > 0) return;
  e.ai.addT = every;
  const alive = w.enemies.filter((x) => !x.dead && !x.boss && !x.ally && !x.clone).length;
  if (alive < maxAlive) w.spawnAdds(type, Math.min(count, maxAlive - alive));
}

// Embestidas encadenadas (Carnage, Thanos). Devuelve true mientras está ocupado.
function startCharge(e, t, wind, dashes, speed, dur) {
  e.ai.state = 'wind'; e.ai.wt = wind; e.ai.wind = wind; e.ai.dashes = dashes; e.ai.dashSpeed = speed; e.ai.dashDur = dur;
  e.face = t ? aimAt(e, t) : R() * TAU;
  e.charging = true;
}
function updateCharge(w, e, dt) {
  if (e.ai.state === 'wind') {
    const t = w.targetFor(e);
    if (t && e.ai.wt > 0.12) e.face = aimAt(e, t);
    e.ai.wt -= dt;
    if (e.ai.wt <= 0) { e.ai.state = 'dash'; e.ai.dt = e.ai.dashDur; e.charging = false; e.contactBonus = 1.5; e.contactCd = 0; }
    return true;
  }
  if (e.ai.state === 'dash') {
    e.x += Math.cos(e.face) * e.ai.dashSpeed * dt;
    e.y += Math.sin(e.face) * e.ai.dashSpeed * dt;
    e.ai.dt -= dt;
    const c = w.cur;
    const hitWall = e.x <= e.r + 1 || e.y <= e.r + 1 || e.x >= c.w - e.r - 1 || e.y >= c.h - e.r - 1;
    if (e.ai.dt <= 0 || hitWall) {
      e.contactBonus = 1;
      e.ai.dashes--;
      if (e.ai.dashes > 0) { e.ai.state = 'wind'; e.ai.wt = 0.3; e.charging = true; }
      else e.ai.state = 'walk';
    }
    return true;
  }
  return false;
}

// Loki: movimiento y disparo compartidos por el real y sus clones.
function lokiMove(w, e, dt) {
  const t = w.targetFor(e);
  if (!t) return null;
  const dx = t.x - e.x, dy = t.y - e.y, dist = Math.hypot(dx, dy) || 1;
  e.face = Math.atan2(dy, dx);
  if (e.ai.s === undefined) e.ai.s = R() < 0.5 ? 1 : -1;
  const radialDir = dist > 360 ? 1 : dist < 240 ? -1 : 0;
  const nx = dx / dist, ny = dy / dist;
  const mx = nx * radialDir - ny * e.ai.s, my = ny * radialDir + nx * e.ai.s;
  const l = Math.hypot(mx, my) || 1;
  e.x += (mx / l) * e.spd * dt;
  e.y += (my / l) * e.spd * dt;
  if (R() < dt * 0.4) e.ai.s = -e.ai.s;
  return t;
}
function lokiDaggers(w, e, t, dmg) {
  for (let i = -1; i <= 1; i++) w.enemyShoot(e, aimAt(e, t) + i * 0.2, { speed: 430, r: 6, dmg, kind: 'edagger' });
}
function spawnLokiClones(w, e, n) {
  for (let i = 0; i < n; i++) {
    const pos = w.freeSpot(220);
    w.spawnEnemy('loki', pos.x, pos.y, { clone: true, hp: 70 * w.bossHpScale, master: e.id, noSpawnAnim: true });
    w.fx.push({ k: 'boom', x: Math.round(pos.x), y: Math.round(pos.y), r: 50, c: '#5fe08a' });
  }
}

const BOSSES = {
  // ───────── Juggernaut ─────────
  // Embestida imparable en línea recta: si choca contra la pared queda ATURDIDO 2,5 s
  // (recibe +50% de daño). Lanza rocas que aturden 1,5 s al jugador y golpea el suelo.
  juggernaut: {
    name: 'Juggernaut', title: 'La Fuerza Imparable', hp: 1700, r: 34, speed: 95, color: '#a8202c', dmg: 18,
    init(w, e) { e.ai.cd = 2; e.ai.state = 'walk'; },
    onHurt(w, e, dmg) { return e.ai.state === 'stunned' ? dmg * 1.5 : dmg; },
    update(w, e, dt) {
      const ph2 = e.hp < e.maxHp * 0.5;
      const ai = e.ai;
      thresholdAdds(w, e, [0.7, 0.4], 'kamikaze', 2);
      timedAdds(w, e, dt, 11, pick(['grunt', 'thief']), 2, 6);
      const t = w.targetFor(e);
      if (ai.state === 'stunned') {
        ai.st -= dt;
        if (ai.st <= 0) { ai.state = 'walk'; ai.cd = 1.2; e.anim = ''; e.stunned = false; }
        return;
      }
      if (ai.state === 'wind') {            // carga la embestida (telegrafiada en el cliente)
        ai.wt -= dt;
        if (t && ai.wt > 0.25) e.face = aimAt(e, t);
        if (ai.wt <= 0) { ai.state = 'dash'; ai.dt = 1.7; e.charging = false; e.contactBonus = 1.8; e.contactCd = 0; e.anim = 'charge'; }
        return;
      }
      if (ai.state === 'dash') {             // imparable: no se desvía ni se detiene al golpear
        const sp = ph2 ? 700 : 620;
        e.x += Math.cos(e.face) * sp * dt;
        e.y += Math.sin(e.face) * sp * dt;
        ai.dt -= dt;
        if (R() < dt * 20) w.fx.push({ k: 'dash', x: Math.round(e.x), y: Math.round(e.y), a: Math.round((e.face + Math.PI) * 100) / 100, c: '#c8a070' });
        const c = w.cur;
        const hitWall = e.x <= e.r + 1 || e.y <= e.r + 1 || e.x >= c.w - e.r - 1 || e.y >= c.h - e.r - 1;
        if (hitWall) {
          ai.state = 'stunned'; ai.st = 2.5; e.anim = 'stunned'; e.stunned = true; e.contactBonus = 1;
          w.fx.push({ k: 'boom', x: Math.round(e.x), y: Math.round(e.y), r: 90, c: '#c8a070' });
          w.fx.push({ k: 'sprite', s: 'HulkSmashCrack', x: Math.round(e.x), y: Math.round(e.y), sz: 150, tint: 1 });
          w.fx.push({ k: 'sfx', s: 'impact', x: Math.round(e.x), y: Math.round(e.y) });
          w.fxText(e.x, e.y - e.r - 24, '¡ATURDIDO! (+50% daño)', '#ffd76a');
          w.enemyAoe(e, e.x, e.y, 110, 10, {});
        } else if (ai.dt <= 0) { ai.state = 'walk'; ai.cd = 1.4; e.contactBonus = 1; e.anim = ''; }
        return;
      }
      if (ai.state === 'throw') {
        ai.wt -= dt;
        if (t) e.face = aimAt(e, t);
        if (ai.wt <= 0) {
          ai.state = 'walk'; ai.cd = ph2 ? 1.6 : 2.2; e.anim = '';
          const n = ph2 ? 3 : 1;
          for (let i = 0; i < n; i++) {
            w.enemyShoot(e, e.face + (i - (n - 1) / 2) * 0.22, { speed: 430, r: 16, dmg: 16, kind: 'jrock', o: { stun: 1.5 } });
          }
        }
        return;
      }
      if (ai.state === 'slam') {
        ai.wt -= dt;
        if (ai.wt <= 0) { ai.state = 'walk'; ai.cd = 1.8; e.anim = ''; }
        return;
      }
      if (t) {
        e.face = aimAt(e, t);
        moveTo(e, t.x, t.y, e.spd, dt);
      }
      ai.cd -= dt;
      if (ai.cd > 0 || !t) return;
      const dist = Math.sqrt(d2(e, t));
      const pat = dist < 170 ? pick(['slam', 'slam', 'charge']) : pick(['charge', 'charge', 'throw', 'throw']);
      if (pat === 'charge') {
        ai.state = 'wind'; ai.wt = 0.85; e.charging = true; e.anim = 'charge';
        w.fxText(e.x, e.y - e.r - 22, '¡EMBESTIDA!', '#ff6464');
      } else if (pat === 'throw') {
        ai.state = 'throw'; ai.wt = 0.6; e.anim = 'attack'; e.atkT = 0.6;
      } else {
        ai.state = 'slam'; ai.wt = 0.9; e.anim = 'slam'; e.atkT = 0.9;
        w.spawnHazard({ kind: 'circle', x: e.x, y: e.y, r: 160, delay: 0.75, dmg: 22, color: '#c8a070', boom: true });
        later(w, e, 0.75, () => {
          w.fx.push({ k: 'sprite', s: 'HulkSmashCrack', x: Math.round(e.x), y: Math.round(e.y), sz: 260, tint: 1 });
          w.fx.push({ k: 'sfx', s: 'impact', x: Math.round(e.x), y: Math.round(e.y) });
        });
      }
    },
  },

  // ───────── Ultrón ─────────
  // Rayos repulsores a distancia, barrido de rayo sostenido e invocación de drones Mini-Ultron.
  ultron: {
    name: 'Ultrón', title: 'La Inteligencia Definitiva', hp: 1550, r: 30, speed: 125, color: '#9aa4b4', dmg: 12,
    init(w, e) { e.ai.cd = 1.8; e.ai.sum = 4; },
    update(w, e, dt) {
      const ph2 = e.hp < e.maxHp * 0.5;
      const ai = e.ai;
      thresholdAdds(w, e, [0.75, 0.5, 0.25], 'miniultron', 2);
      const t = w.targetFor(e);
      if (!t) return;
      e.face = aimAt(e, t);
      // Mantiene la distancia (vuela) y se mueve lateralmente.
      const dist = Math.sqrt(d2(e, t));
      if (ai.s === undefined) ai.s = 1;
      const rad = dist > 420 ? 1 : dist < 280 ? -1 : 0;
      const nx = (t.x - e.x) / (dist || 1), ny = (t.y - e.y) / (dist || 1);
      const mx = nx * rad - ny * ai.s * 0.7, my = ny * rad + nx * ai.s * 0.7, ml = Math.hypot(mx, my) || 1;
      e.x += (mx / ml) * e.spd * dt; e.y += (my / ml) * e.spd * dt;
      if (R() < dt * 0.35) ai.s = -ai.s;

      // Invocación de drones (con tope de enemigos vivos).
      ai.sum -= dt;
      if (ai.sum <= 0) {
        ai.sum = ph2 ? 7 : 9.5;
        const alive = w.enemies.filter((x) => !x.dead && !x.boss && !x.ally).length;
        if (alive < 10) {
          e.anim = 'summon'; e.atkT = 0.8;
          later(w, e, 0.8, () => { e.anim = ''; });
          w.fxText(e.x, e.y - e.r - 22, '¡DRONES DE ULTRÓN!', '#ff4a4a');
          for (let i = 0; i < (ph2 ? 4 : 3); i++) {
            const a = (i / 3) * TAU;
            w.spawnEnemy('miniultron', e.x + Math.cos(a) * 60, e.y + Math.sin(a) * 60);
          }
          return;
        }
      }
      ai.cd -= dt;
      if (ai.cd > 0) return;
      const pat = pick(ph2 ? ['burst', 'burst', 'beam', 'spread'] : ['burst', 'burst', 'beam']);
      e.anim = 'attack'; e.atkT = 0.6;
      later(w, e, 0.6, () => { if (e.anim === 'attack') e.anim = ''; });
      if (pat === 'burst') {               // ráfaga de 3 repulsores apuntados
        ai.cd = ph2 ? 1.3 : 1.8;
        for (let i = 0; i < 3; i++) {
          later(w, e, i * 0.16, () => {
            const tt = w.targetFor(e);
            if (!tt) return;
            w.enemyShoot(e, aimAt(e, tt) + (R() - 0.5) * 0.08, { speed: 560, r: 9, dmg: 13, kind: 'repulsor' });
            w.fx.push({ k: 'sfx', s: 'laser', x: Math.round(e.x), y: Math.round(e.y) });
          });
        }
      } else if (pat === 'spread') {       // abanico de 7
        ai.cd = 1.9;
        for (let i = -3; i <= 3; i++) w.enemyShoot(e, e.face + i * 0.17, { speed: 470, r: 8, dmg: 11, kind: 'repulsor' });
        w.fx.push({ k: 'sfx', s: 'laser', x: Math.round(e.x), y: Math.round(e.y) });
      } else {                             // rayo sostenido que barre (avisado 0,9 s)
        ai.cd = 3.4;
        const dir = R() < 0.5 ? 1 : -1;
        w.spawnHazard({ kind: 'beam', x: e.x, y: e.y, follow: e.id, delay: 0.9, dur: 1.5, dps: 42, color: '#ff3a3a', angle: e.face - dir * 0.6, angVel: dir * 0.8, len: 900, width: 26 });
        w.fxText(e.x, e.y - e.r - 22, '¡RAYO REPULSOR!', '#ff6464');
      }
    },
  },

  // ───────── Magneto ─────────
  // Campo magnético que devuelve los proyectiles METÁLICOS (misiles, escudo, etc.) y lanza escombros.
  // Ajuste de dificultad (piso 1): sus proyectiles van un 20% más lentos (rocas 360, anillo 240, esquirlas 208).
  magneto: {
    name: 'Magneto', title: 'Amo del Magnetismo', hp: 1400, r: 34, speed: 110, color: '#b8323e', gem: 'poder', dmg: 14,
    init(w, e) { e.ai.cd = 2.2; e.ai.field = 0; e.ai.fieldCd = 3.5; },
    update(w, e, dt) {
      const ph2 = e.hp < e.maxHp * 0.5;
      if (e.ai.field > 0) {
        e.ai.field -= dt;
        e.field = true;
        for (const pr of w.projs) {
          if (pr.dead || pr.side !== 'p' || !pr.metal || d2(pr, e) > 270 * 270) continue;
          const o = w.players.get(pr.ownerId);
          const a = o ? Math.atan2(o.y - pr.y, o.x - pr.x) : Math.atan2(pr.vy, pr.vx) + Math.PI;
          const sp = Math.hypot(pr.vx, pr.vy) * 1.1;
          pr.vx = Math.cos(a) * sp; pr.vy = Math.sin(a) * sp;
          pr.side = 'e'; pr.dmg = 12 * w.scale.dmg; pr.o = {}; pr.homing = 0; pr.boomerang = false; pr.explodeR = 0; pr.pierce = 0;
          pr.life = Math.max(pr.life, 1.5); pr.srcId = e.id;
          w.fx.push({ k: 'spark', x: Math.round(pr.x), y: Math.round(pr.y), c: '#d070ff' });
        }
      } else {
        e.field = false;
        e.ai.fieldCd -= dt;
        if (e.ai.fieldCd <= 0) {
          e.ai.field = ph2 ? 4.5 : 3.2;
          e.ai.fieldCd = ph2 ? 3 : 4.5;
          w.fxText(e.x, e.y - e.r - 22, '¡CAMPO MAGNÉTICO! (devuelve el metal)', '#d070ff');
        }
      }
      const c = w.cur;
      if (!e.ai.dest || moveTo(e, e.ai.dest.x, e.ai.dest.y, e.spd, dt) < 10) e.ai.dest = { x: c.w * (0.25 + R() * 0.5), y: c.h * (0.2 + R() * 0.6) };
      const t = w.targetFor(e);
      if (t) e.face = aimAt(e, t);
      e.ai.cd -= dt;
      if (e.ai.cd <= 0 && t) {
        e.ai.cd = ph2 ? 1.9 : 2.8;
        const pat = pick(['throw', 'throw', 'ring', 'pull']);
        if (pat === 'throw') {
          for (const p of w.alivePlayers()) {
            for (let i = 0; i < 3; i++) later(w, e, i * 0.16, () => w.enemyShoot(e, aimAt(e, p) + (R() - 0.5) * 0.15, { speed: 360, r: 15, dmg: 15, kind: 'rock' }));
          }
        } else if (pat === 'ring') {
          radial(w, e, 14, { speed: 240, r: 13, dmg: 14, kind: 'rock' }, R());
          if (ph2) later(w, e, 0.45, () => radial(w, e, 14, { speed: 240, r: 13, dmg: 14, kind: 'rock' }, R()));
        } else {
          w.pull = { x: e.x, y: e.y, s: 140, t: 2 };
          w.fxText(e.x, e.y - e.r - 22, 'Atracción magnética', '#d070ff');
          for (let i = 0; i < 10; i++) later(w, e, i * 0.2, () => radial(w, e, 4, { speed: 208, r: 7, dmg: 10, kind: 'shard', metal: true }, i * 0.35));
          e.ai.cd += 1;
        }
      }
      thresholdAdds(w, e, [0.7, 0.4], 'acolyte', 2 + w.players.size);
    },
  },

  // ───────── Carnage ─────────
  // Ultra rápido: embestidas encadenadas, torbellino; todo su daño causa sangrado y le cura.
  carnage: {
    name: 'Carnage', title: 'El Simbionte Asesino', hp: 1600, r: 26, speed: 250, color: '#d01818', gem: 'alma', dmg: 16, lifesteal: 0.6, bleed: true,
    init(w, e) { e.ai.cd = 1.5; e.ai.state = 'walk'; },
    update(w, e, dt) {
      const ph2 = e.hp < e.maxHp * 0.5;
      const sm = ph2 ? 1.3 : 1;
      // Pista de animación para el cliente (hojas Carnage1/Carnage2).
      e.ai.whipT = (e.ai.whipT || 0) - dt;
      e.anim = e.ai.state === 'wind' || e.ai.state === 'dash' ? 'charge' : e.ai.state === 'whirl' ? 'whirl' : e.ai.whipT > 0 ? 'whip' : '';
      if (updateCharge(w, e, dt)) return;
      const t = w.targetFor(e);
      if (e.ai.state === 'whirl') {
        e.ai.wt -= dt;
        e.ai.tick = (e.ai.tick || 0) - dt;
        if (t) moveTo(e, t.x, t.y, e.spd * 0.45, dt);
        if (e.ai.tick <= 0) {
          e.ai.tick = 0.2;
          w.fx.push({ k: 'ring', x: Math.round(e.x), y: Math.round(e.y), r: 135, c: '#ff2020', s: 'CrimsonSlash' });
          w.enemyAoe(e, e.x, e.y, 135, 9, { bleed: true, bleedDps: 6 * w.scale.dmg });
        }
        if (e.ai.wt <= 0) { e.ai.state = 'walk'; e.ai.cd = 1.2; }
        return;
      }
      if (t) { e.face = aimAt(e, t); if (Math.sqrt(d2(e, t)) > e.r + 20) moveTo(e, t.x, t.y, e.spd * sm, dt); }
      e.ai.cd -= dt;
      if (e.ai.cd <= 0 && t) {
        const pat = pick(['dash', 'dash', 'whirl', 'spikes']);
        if (pat === 'dash') { startCharge(e, t, 0.4, ph2 ? 4 : 3, 1150, 0.32); e.ai.cd = 1.4; }
        else if (pat === 'whirl') { e.ai.state = 'whirl'; e.ai.wt = 1.4; e.ai.tick = 0; w.fxText(e.x, e.y - e.r - 20, '¡Torbellino!', '#ff4040'); }
        else {
          e.ai.whipT = 1.0;
          for (let k = 0; k < 3; k++) later(w, e, k * 0.3, () => radial(w, e, 12, { speed: 340, r: 7, dmg: 9, kind: 'tendrilE', o: { bleed: true, bleedDps: 5 * w.scale.dmg, heal: 0.6 } }, k * 0.26));
          e.ai.cd = 1.6;
        }
      }
      if (ph2 && !e.ai.ph2) { e.ai.ph2 = true; w.toast('¡Carnage enloquece!', '#ff4040'); w.spawnAdds('symbiote', 3 + w.players.size); }
      if (ph2) timedAdds(w, e, dt, 18, 'symbiote', 2 + w.players.size, 10);
    },
  },

  // ───────── Loki (jefe secreto) ─────────
  // Genera 3 clones falsos idénticos; se reordenan con humo cada pocos segundos.
  loki: {
    name: 'Loki', title: 'Dios del Engaño', hp: 1300, r: 24, speed: 170, color: '#2f9e4a', gem: 'mente', dmg: 10,
    init(w, e) { e.ai.cd = 1.5; e.ai.fire = 1; e.ai.shuffle = 5; e.ai.cloneCd = 0; spawnLokiClones(w, e, 3); },
    update(w, e, dt) {
      const ph2 = e.hp < e.maxHp * 0.5;
      const t = lokiMove(w, e, dt);
      e.ai.fire -= dt;
      if (t && e.ai.fire <= 0) { e.ai.fire = ph2 ? 0.9 : 1.2; lokiDaggers(w, e, t, 10); }
      e.ai.cd -= dt;
      if (t && e.ai.cd <= 0) {
        e.ai.cd = ph2 ? 2.4 : 3.2;
        const pat = pick(['ring', 'orb', 'fan']);
        if (pat === 'ring') radial(w, e, 14, { speed: 300, r: 6, dmg: 9, kind: 'edagger' }, R());
        else if (pat === 'orb') w.enemyShoot(e, aimAt(e, t), { speed: 220, r: 18, dmg: 22, kind: 'mindorb', life: 5 });
        else for (let i = -3; i <= 3; i++) w.enemyShoot(e, aimAt(e, t) + i * 0.13, { speed: 380, r: 6, dmg: 9, kind: 'edagger' });
      }
      // Barajar posiciones (real + clones) para confundir.
      e.ai.shuffle -= dt;
      if (e.ai.shuffle <= 0) {
        e.ai.shuffle = ph2 ? 4 : 6;
        const group = w.enemies.filter((x) => !x.dead && (x === e || (x.clone && x.master === e.id)));
        for (const x of group) {
          w.fx.push({ k: 'boom', x: Math.round(x.x), y: Math.round(x.y), r: 45, c: '#5fe08a' });
          const pos = w.freeSpot(200);
          x.x = pos.x; x.y = pos.y;
        }
        w.fxText(e.x, e.y - 40, '¿Cuál es el verdadero?', '#d8b44a');
      }
      // Reponer clones hasta 3.
      e.ai.cloneCd -= dt;
      const clones = w.enemies.filter((x) => !x.dead && x.clone && x.master === e.id).length;
      if (clones < 3 && e.ai.cloneCd <= 0) { e.ai.cloneCd = ph2 ? 5 : 8; spawnLokiClones(w, e, 3 - clones); }
      thresholdAdds(w, e, [0.6, 0.3], 'grunt', 2 + w.players.size);
    },
    updateClone(w, e, dt) {
      const t = lokiMove(w, e, dt);
      e.ai.fire = (e.ai.fire == null ? 1 + R() : e.ai.fire) - dt;
      if (t && e.ai.fire <= 0) { e.ai.fire = 1.4; lokiDaggers(w, e, t, 4); }
    },
    onDeath(w, e) {
      if (!e.clone) return;
      w.fxText(e.x, e.y - 30, '¡Era una ilusión!', '#5fe08a');
      w.enemyAoe(e, e.x, e.y, 60, 6, {});
    },
  },

  // ───────── Dormammu ─────────
  // Zonas místicas de peligro, lluvia de meteoritos, anillos de fuego y haz giratorio.
  dormammu: {
    name: 'Dormammu', title: 'Señor de la Dimensión Oscura', hp: 2200, r: 42, speed: 70, color: '#ff6a1a', gem: 'tiempo', dmg: 20,
    init(w, e) { e.ai.cd = 2; },
    update(w, e, dt) {
      const ph2 = e.hp < e.maxHp * 0.5;
      const c = w.cur;
      const t = w.targetFor(e);
      if (t) { e.face = aimAt(e, t); moveTo(e, (t.x + c.w / 2) / 2, (t.y + c.h / 2) / 2, e.spd, dt); }
      e.ai.cd -= dt;
      if (e.ai.cd <= 0 && t) {
        e.ai.cd = ph2 ? 2.0 : 2.8;
        const pat = pick(['zones', 'meteors', 'ring', 'beam']);
        if (pat === 'zones' || ph2) {
          for (const p of w.alivePlayers()) {
            for (let i = 0; i < 2; i++) {
              const a = R() * TAU, d = R() * 140;
              w.spawnHazard({ kind: 'circle', x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, r: 75, delay: 1.1, dur: 2.6, dps: 20, color: '#c040ff' });
            }
          }
          if (ph2) for (let i = 0; i < 3; i++) { const s = w.freeSpot(0); w.spawnHazard({ kind: 'circle', x: s.x, y: s.y, r: 90, delay: 1.2, dur: 3.5, dps: 20, color: '#c040ff' }); }
        }
        if (pat === 'meteors') {
          w.fxText(e.x, e.y - e.r - 22, '¡Lluvia de meteoritos!', '#ff9a3a');
          for (let i = 0; i < 14; i++) {
            later(w, e, i * 0.13, () => {
              const p = pick(w.alivePlayers()) || e;
              w.spawnHazard({ kind: 'meteor', x: p.x + (R() - 0.5) * 440, y: p.y + (R() - 0.5) * 440, r: 60, delay: 1.0, dmg: 26, color: '#ff7a1a', boom: true });
            });
          }
        } else if (pat === 'ring') {
          for (let k = 0; k < 3; k++) later(w, e, k * 0.4, () => radial(w, e, 18, { speed: 260, r: 9, dmg: 13, kind: 'fire' }, k * 0.17));
        } else if (pat === 'beam') {
          w.spawnHazard({ kind: 'beam', follow: e.id, x: e.x, y: e.y, angle: aimAt(e, t), angVel: (R() < 0.5 ? -1 : 1) * 1.1, len: 900, width: 34, delay: 0.9, dur: 3.2, dps: 34, color: '#ff7a1a' });
          e.ai.cd += 1;
        }
      }
      thresholdAdds(w, e, [0.66, 0.33], 'mindless', 2 + w.players.size);
      timedAdds(w, e, dt, 24, 'mystic', 2, 8);
    },
  },

  // ───────── Thanos ─────────
  // Golpes y embestidas + los poderes de las Gemas del Infinito que el equipo AÚN NO tiene.
  thanos: {
    name: 'Thanos', title: 'El Titán Loco', hp: 3000, r: 38, speed: 130, color: '#7a4aa8', dmg: 24,
    init(w, e) {
      e.ai.cd = 2;
      e.ai.state = 'walk';
      e.ai.missing = GEM_ORDER.filter((g) => !w.gems.has(g));
      w.schedule(1.5, () => w.toast(
        e.ai.missing.length
          ? `Thanos empuña las gemas que os faltan: ${e.ai.missing.map((g) => GEMS[g].short).join(', ')}`
          : 'Tenéis las 6 gemas: Thanos solo cuenta con su fuerza bruta',
        '#c9a23a'));
    },
    update(w, e, dt) {
      const ph2 = e.hp < e.maxHp * 0.5;
      if (updateCharge(w, e, dt)) return;
      if (e.ai.haste > 0) e.ai.haste -= dt;
      const t = w.targetFor(e);
      if (e.ai.state === 'slam') { e.ai.wt -= dt; if (e.ai.wt <= 0) e.ai.state = 'walk'; return; }
      if (t) { e.face = aimAt(e, t); if (Math.sqrt(d2(e, t)) > e.r + 30) moveTo(e, t.x, t.y, e.spd * (e.ai.haste > 0 ? 1.5 : 1), dt); }
      e.ai.cd -= dt;
      if (e.ai.cd > 0 || !t) {
        thresholdAdds(w, e, [0.75, 0.5, 0.25], 'outrider', 2 + w.players.size);
        return;
      }
      e.ai.cd = ph2 ? 1.9 : 2.6;
      const missing = e.ai.missing;
      const pat = missing.length && R() < 0.6 ? pick(missing) : pick(['slam', 'charge']);
      const say = (s, c) => w.fxText(e.x, e.y - e.r - 24, s, c);
      switch (pat) {
        case 'slam':
          e.ai.state = 'slam'; e.ai.wt = 0.8;
          w.spawnHazard({ kind: 'circle', x: e.x, y: e.y, r: 150, delay: 0.75, dmg: 32, color: '#c9a23a', boom: true });
          break;
        case 'charge':
          startCharge(e, t, 0.5, ph2 ? 2 : 1, 900, 0.55);
          break;
        case 'poder':
          say('Gema del Poder', GEMS.poder.color);
          for (let k = 0; k < 3; k++) later(w, e, k * 0.35, () => radial(w, e, 28, { speed: 330, r: 8, dmg: 16, kind: 'power' }, k * 0.11));
          break;
        case 'espacio': {
          say('Gema del Espacio', GEMS.espacio.color);
          const p = pick(w.alivePlayers()) || t;
          w.fx.push({ k: 'ring', x: Math.round(e.x), y: Math.round(e.y), r: 70, c: GEMS.espacio.color });
          const a = R() * TAU;
          e.x = p.x + Math.cos(a) * 110; e.y = p.y + Math.sin(a) * 110;
          w.clampToRoom(e);
          w.fx.push({ k: 'ring', x: Math.round(e.x), y: Math.round(e.y), r: 70, c: GEMS.espacio.color });
          e.ai.state = 'slam'; e.ai.wt = 0.7;
          w.spawnHazard({ kind: 'circle', x: e.x, y: e.y, r: 140, delay: 0.6, dmg: 30, color: GEMS.espacio.color, boom: true });
          break;
        }
        case 'realidad':
          say('Gema de la Realidad', GEMS.realidad.color);
          for (let i = 0; i < 7; i++) {
            const p = pick(w.alivePlayers()) || t;
            w.spawnHazard({ kind: 'circle', x: p.x + (R() - 0.5) * 300, y: p.y + (R() - 0.5) * 300, r: 85, delay: 1.0, dur: 3, dps: 22, color: GEMS.realidad.color });
          }
          break;
        case 'tiempo':
          say('Gema del Tiempo: ¡se regenera!', GEMS.tiempo.color);
          e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.07);
          e.ai.haste = 3;
          w.fx.push({ k: 'ring', x: Math.round(e.x), y: Math.round(e.y), r: 120, c: GEMS.tiempo.color });
          break;
        case 'alma': {
          let best = null, bd = 500 * 500;
          for (const p of w.alivePlayers()) { const dd = d2(p, e); if (dd < bd) { bd = dd; best = p; } }
          if (best) {
            say('Gema del Alma: ¡aléjate!', GEMS.alma.color);
            w.spawnHazard({ kind: 'tether', follow: e.id, x: e.x, y: e.y, targetId: best.id, tx: best.x, ty: best.y, dur: 2.2, dps: 16, color: GEMS.alma.color });
          }
          break;
        }
        case 'mente':
          say('Gema de la Mente: ¡controles invertidos!', GEMS.mente.color);
          for (const p of w.alivePlayers()) w.addStatus(p, 'confuse', 2.2);
          for (let i = -4; i <= 4; i++) w.enemyShoot(e, aimAt(e, t) + i * 0.12, { speed: 360, r: 7, dmg: 12, kind: 'mindorb' });
          break;
        default: break;
      }
      thresholdAdds(w, e, [0.75, 0.5, 0.25], 'outrider', 2 + w.players.size);
    },
  },

  // ───────── Galactus ─────────
  // Jefe final verdadero (solo con las 6 gemas). Haces cósmicos giratorios, devorar (atracción),
  // meteoritos, ráfagas oculares y heraldos.
  galactus: {
    name: 'Galactus', title: 'Devorador de Mundos', hp: 5200, r: 90, speed: 28, color: '#6a5acd', dmg: 40,
    init(w, e) { e.ai.cd = 2.5; },
    update(w, e, dt) {
      const ph2 = e.hp < e.maxHp * 0.5;
      const c = w.cur;
      moveTo(e, c.w / 2, c.h / 2, e.spd, dt);
      const t = w.targetFor(e);
      if (t) e.face = aimAt(e, t);
      if (ph2 && !e.ai.ph2) { e.ai.ph2 = true; w.toast('¡Galactus libera el Poder Cósmico!', '#a08aff'); }
      e.ai.cd -= dt;
      if (e.ai.cd <= 0 && t) {
        e.ai.cd = ph2 ? 2.6 : 3.4;
        const pat = pick(['beam', 'devour', 'meteors', 'eyes']);
        if (pat === 'beam') {
          const n = ph2 ? 2 : 1, base = aimAt(e, t), dir = R() < 0.5 ? -1 : 1;
          for (let i = 0; i < n; i++) w.spawnHazard({ kind: 'beam', follow: e.id, x: e.x, y: e.y, angle: base + i * Math.PI, angVel: dir * 0.9, len: 1300, width: 50, delay: 1.1, dur: 5, dps: 42, color: '#c8b8ff' });
          e.ai.cd += 2.5;
        } else if (pat === 'devour') {
          w.fxText(e.x, e.y - e.r - 30, '¡DEVORAR!', '#a08aff');
          w.pull = { x: e.x, y: e.y, s: 165, t: 3 };
          w.spawnHazard({ kind: 'circle', follow: e.id, x: e.x, y: e.y, r: 190, delay: 0.8, dur: 2.6, dps: 55, color: '#a08aff' });
          e.ai.cd += 1;
        } else if (pat === 'meteors') {
          for (let i = 0; i < 22; i++) {
            later(w, e, i * 0.12, () => {
              const p = pick(w.alivePlayers()) || e;
              w.spawnHazard({ kind: 'meteor', x: p.x + (R() - 0.5) * 520, y: p.y + (R() - 0.5) * 520, r: 70, delay: 1.0, dmg: 30, color: '#9a7aff', boom: true });
            });
          }
        } else {
          for (let k = 0; k < 3; k++) {
            later(w, e, k * 0.5, () => { for (const p of w.alivePlayers()) w.enemyShoot(e, aimAt(e, p), { speed: 380, r: 22, dmg: 26, kind: 'cosmic', life: 5 }); });
          }
        }
      }
      timedAdds(w, e, dt, 22, 'herald', 1 + Math.floor(w.players.size / 2), 4);
    },
  },
};

module.exports = { BOSSES };
