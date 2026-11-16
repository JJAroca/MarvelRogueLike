'use strict';
// Enemigos normales y su IA. Los aliados (Bruja Escarlata) reutilizan la misma IA
// pero eligen como objetivo a enemigos hostiles.
//   group: cuántos aparecen juntos por cada entrada de la oleada (enjambres).
const TAU = Math.PI * 2;

const ENEMIES = {
  // Calle / laboratorio
  grunt:      { name: 'Matón callejero',      hp: 30,  r: 14, speed: 125, dmg: 10, color: '#6a4a32', ai: 'melee' },
  thief:      { name: 'Ladrón',               hp: 20,  r: 13, speed: 185, dmg: 8,  color: '#3a3f4a', ai: 'melee', bleed: true },
  // Robot Kamikaze: se arma 0,9 s (parpadeo + retícula) y explota: 45–65% de la vida MÁXIMA del
  // jugador según la distancia, y daño masivo también a enemigos y jefes cercanos (fuego amigo).
  kamikaze:   { name: 'Robot Kamikaze',       hp: 26,  r: 15, speed: 175, dmg: 0, color: '#8a5a3a', ai: 'kamikaze', blastR: 115, noContact: true,
                onDeath(w, e) { if (e.ai.state === 'arm') kamikazeBlast(w, e); } },   // si lo matas armado, detona igual
  // Goblin Saqueador: roba 1 ítem del inventario al tocarte y huye 12 s (luego escapa por un portal).
  goblin:     { name: 'Goblin Saqueador',     hp: 70,  r: 14, speed: 205, dmg: 5, color: '#6a3a8a', ai: 'goblin', noContact: true,
                onDeath(w, e) { goblinLoot(w, e); } },
  // A.I.M.
  shooter:    { name: 'Soldado de A.I.M.',    hp: 22,  r: 13, speed: 95,  dmg: 8,  color: '#d4b02a', ai: 'ranged', fireRate: 1.7, projSpeed: 330, range: 300, proj: 'flask' },
  aimlaser:   { name: 'Tirador láser de A.I.M.', hp: 26, r: 13, speed: 100, dmg: 9, color: '#f0c020', ai: 'ranged', fireRate: 1.5, projSpeed: 600, range: 380, proj: 'laser' },
  // Ultrón
  miniultron: { name: 'Mini-Ultron',          hp: 18,  r: 12, speed: 205, dmg: 7,  color: '#9aa0aa', ai: 'swarm', fireRate: 1.8, projSpeed: 480, proj: 'laser', group: 3 },
  ninja:      { name: 'Ninja Cibernético',    hp: 34,  r: 14, speed: 165, dmg: 13, color: '#8a1a2a', ai: 'ninja' },
  // Otros
  brute:      { name: 'Bruto',                hp: 95,  r: 22, speed: 70,  dmg: 18, color: '#7a4a2a', ai: 'charger' },
  acolyte:    { name: 'Acólito',              hp: 28,  r: 14, speed: 105, dmg: 9,  color: '#8a2a6a', ai: 'ranged', fireRate: 1.5, projSpeed: 360, range: 280, metal: true },
  symbiote:   { name: 'Engendro simbionte',   hp: 22,  r: 13, speed: 190, dmg: 8,  color: '#c01818', ai: 'melee', bleed: true },
  mystic:     { name: 'Discípulo místico',    hp: 30,  r: 14, speed: 85,  dmg: 16, color: '#b05cff', ai: 'caster' },
  mindless:   { name: 'Sin Mente',            hp: 110, r: 22, speed: 75,  dmg: 20, color: '#e86a1a', ai: 'charger' },
  outrider:   { name: 'Outrider',             hp: 40,  r: 15, speed: 175, dmg: 12, color: '#5a5a7a', ai: 'melee' },
  herald:     { name: 'Heraldo cósmico',      hp: 120, r: 18, speed: 215, dmg: 14, color: '#c8d8ff', ai: 'ranged', fireRate: 1.0, projSpeed: 480, range: 340 },
};

const KAMIKAZE_ARM = 0.9;

// Explosión del kamikaze (también la usan las muertes con el robot ya armado).
function kamikazeBlast(w, e) {
  if (e.blown) return;
  e.blown = true;
  const R = e.def.blastR || 110, x = Math.round(e.x), y = Math.round(e.y);
  w.fx.push({ k: 'boom', x, y, r: R, c: '#ff8a2a', s: 'ExplosionBoom' });
  w.fx.push({ k: 'sprite', s: 'ExplosionBoom', x, y, sz: R * 2.4 });
  w.fx.push({ k: 'sfx', s: 'impact', x, y });
  if (!e.ally) {
    for (const p of w.players.values()) {
      if (p.downed || p.astral) continue;
      const d = Math.hypot(p.x - e.x, p.y - e.y);
      if (d > R + p.r) continue;
      const frac = 0.65 - 0.2 * Math.min(1, d / R);   // 65% en el centro → 45% en el borde
      w.hurtPlayer(p, p.maxHp * frac, { trueDmg: true });
      w.fx.push({ k: 'shake', s: 12, p: p.id });
    }
  }
  // Fuego amigo: daña a enemigos y jefes cercanos (premia esquivar con dash y atraerlos).
  for (const o of w.enemies) {
    if (o === e || o.dead || o.ally || o.spawning > 0) continue;
    const rr = R + o.r;
    if ((o.x - e.x) ** 2 + (o.y - e.y) ** 2 > rr * rr) continue;
    w.hurtEnemy(o, o.boss ? 60 + o.maxHp * 0.08 : 160, {});
    if (o.boss) w.fxText(o.x, o.y - o.r - 26, '¡FUEGO AMIGO!', '#ff9a3a');
  }
}

// Muerte del Goblin: suelta el ítem robado + cristales Iso-8.
function goblinLoot(w, e) {
  if (e.stolen) {
    const { ITEMS } = require('./items');
    const it = ITEMS[e.stolen];
    w.spawnPickup('item', e.x, e.y, { itemId: e.stolen, rarity: it ? it.rarity : 'common' });
    w.toast(`💰 ¡Goblin abatido! Recuperáis ${it ? it.name : 'el ítem'}`, '#c08aff');
    e.stolen = null;
  }
  for (let i = 0; i < 3; i++) w.spawnPickup('iso', e.x + (i - 1) * 30, e.y + 26, { amount: 10 });
  if (w.goblinChase) w.goblinChase = null;
}

function move(e, ax, ay, spd, dt) {
  const l = Math.hypot(ax, ay);
  if (l < 1e-6) return;
  e.x += (ax / l) * spd * dt;
  e.y += (ay / l) * spd * dt;
}

function updateEnemy(w, e, dt) {
  const d = e.def;
  const ai = e.ai;
  ai.t += dt;

  if (e.st.confuse > 0) {
    if (!ai.wdT || ai.t > ai.wdT) { ai.wd = Math.random() * TAU; ai.wdT = ai.t + 0.6; }
    move(e, Math.cos(ai.wd), Math.sin(ai.wd), e.spd * 0.7, dt);
    return;
  }

  const t = w.targetFor(e);
  if (!t) return;
  const dx = t.x - e.x, dy = t.y - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  if (!e.charging && ai.state !== 'charge' && ai.state !== 'arm') e.face = Math.atan2(dy, dx);

  switch (d.ai) {
    case 'melee':
      if (dist > e.r + 6) move(e, dx, dy, e.spd, dt);
      break;

    case 'ranged': {
      const want = d.range || 300;
      if (ai.s === undefined) ai.s = Math.random() < 0.5 ? 1 : -1;
      const radial = dist > want + 40 ? 1 : dist < want - 60 ? -1 : 0;
      const nx = dx / dist, ny = dy / dist;
      move(e, nx * radial + -ny * ai.s * 0.6, ny * radial + nx * ai.s * 0.6, e.spd, dt);
      if (Math.random() < dt * 0.3) ai.s = -ai.s;
      if (ai.fire === undefined) ai.fire = 0.5 + Math.random() * d.fireRate;
      ai.fire -= dt;
      if (ai.fire <= 0) {
        ai.fire = d.fireRate * (0.8 + Math.random() * 0.4);
        w.enemyShoot(e, Math.atan2(dy, dx), { speed: d.projSpeed, r: 6, dmg: d.dmg, kind: d.proj || (d.metal ? 'shard' : 'orb'), metal: !!d.metal });
      }
      break;
    }

    // Enjambre (Mini-Ultron): orbita al objetivo a media distancia, se lanza en picado y dispara.
    case 'swarm': {
      if (ai.orb === undefined) { ai.orb = Math.random() * TAU; ai.rad = 130 + Math.random() * 70; ai.dir = Math.random() < 0.5 ? 1 : -1; }
      ai.orb += ai.dir * dt * 1.6;
      let tx = t.x + Math.cos(ai.orb) * ai.rad, ty = t.y + Math.sin(ai.orb) * ai.rad;
      ai.dive = (ai.dive || 0) - dt;
      if (ai.dive <= 0 && Math.random() < dt * 0.25) ai.dive = 0.9;
      if (ai.dive > 0.2) { tx = t.x; ty = t.y; }
      move(e, tx - e.x, ty - e.y, e.spd * (ai.dive > 0.2 ? 1.35 : 1), dt);
      if (ai.fire === undefined) ai.fire = 0.6 + Math.random() * d.fireRate;
      ai.fire -= dt;
      if (ai.fire <= 0) {
        ai.fire = d.fireRate * (0.8 + Math.random() * 0.5);
        w.enemyShoot(e, Math.atan2(dy, dx), { speed: d.projSpeed, r: 4, dmg: d.dmg, kind: d.proj });
      }
      break;
    }

    // Robot Kamikaze: corre hacia el jugador; cerca se ARMA 0,9 s (telegrafiado) y explota.
    case 'kamikaze': {
      if (ai.state === 'arm') {
        ai.armT -= dt;
        e.atkT = 0.2;
        if (ai.armT <= 0) { kamikazeBlast(w, e); w.killEnemy(e, null, true); }
        break;
      }
      move(e, dx, dy, e.spd, dt);
      if (dist < e.r + (t.r || 16) + 26) {
        ai.state = 'arm'; ai.armT = KAMIKAZE_ARM; e.anim = 'attack';
        w.fx.push({ k: 'tele', x: Math.round(e.x), y: Math.round(e.y), r: d.blastR || 110, life: KAMIKAZE_ARM, s: 'TargetCrosshair' });
        w.fxText(e.x, e.y - e.r - 20, '¡AL SUELO!', '#ff4040');
      }
      break;
    }

    // Goblin Saqueador: va a por quien más ítems lleva, roba uno y huye.
    case 'goblin': {
      if (ai.state === 'flee') {
        ai.fleeT -= dt;
        e.anim = 'run';
        // Huye del jugador más cercano; si toca pared, se desliza a lo largo de ella.
        let fx = -dx, fy = -dy;
        const c = w.cur, m = 90;
        if (e.x < m || e.x > c.w - m) fx *= 0.2, fy += (fy >= 0 ? 1 : -1) * dist;
        if (e.y < m || e.y > c.h - m) fy *= 0.2, fx += (fx >= 0 ? 1 : -1) * dist;
        move(e, fx + Math.sin(ai.t * 3) * dist * 0.3, fy + Math.cos(ai.t * 2.3) * dist * 0.3, e.spd * 1.25, dt);
        e.face = Math.atan2(fy, fx);
        if (ai.fleeT <= 0) w.goblinEscape(e);
        break;
      }
      // Objetivo: el jugador vivo con más ítems.
      let tgt = null;
      for (const p of w.alivePlayers()) if (!tgt || p.items.length > tgt.items.length) tgt = p;
      if (!tgt) break;
      const gx = tgt.x - e.x, gy = tgt.y - e.y, gd = Math.hypot(gx, gy) || 1;
      e.face = Math.atan2(gy, gx);
      e.anim = '';
      move(e, gx, gy, e.spd, dt);
      ai.grabCd = (ai.grabCd || 0) - dt;
      if (gd < e.r + tgt.r + 10 && ai.grabCd <= 0) {
        ai.grabCd = 1.2;
        e.atkT = 0.4;
        if (tgt.items.length && !(tgt.invulnT > 0) && !(tgt.dashT > 0)) {
          const i = Math.floor(Math.random() * tgt.items.length);
          const id = tgt.items.splice(i, 1)[0];
          w.recalc(tgt);
          tgt.client.conn.send(JSON.stringify({ t: 'inv', items: tgt.items }));
          e.stolen = id;
          ai.state = 'flee'; ai.fleeT = 12;
          const { ITEMS } = require('./items');
          w.fxText(tgt.x, tgt.y - 50, `¡Te ha robado ${ITEMS[id] ? ITEMS[id].name : id}!`, '#c08aff');
          w.toast(`💰 ¡El Goblin le ha robado ${ITEMS[id] ? ITEMS[id].name : 'un ítem'} a ${tgt.name}! Tenéis 12 s antes de que escape`, '#c08aff');
          w.fx.push({ k: 'sfx', s: 'coin', x: Math.round(e.x), y: Math.round(e.y) });
        } else w.enemyHitPlayer(e, tgt, d.dmg, {});
      }
      break;
    }

    // Ninja Cibernético: se acerca y cada pocos segundos se teletransporta a la espalda del objetivo.
    case 'ninja': {
      ai.blink = (ai.blink == null ? 2 + Math.random() * 2 : ai.blink) - dt;
      if (ai.blink <= 0 && dist < 420) {
        ai.blink = 3 + Math.random() * 1.5;
        const back = Math.atan2(dy, dx);
        w.fx.push({ k: 'ring', x: Math.round(e.x), y: Math.round(e.y), r: 30, c: '#ff2a4a' });
        e.x = t.x + Math.cos(back) * 46;
        e.y = t.y + Math.sin(back) * 46;
        w.clampToRoom(e);
        e.face = Math.atan2(t.y - e.y, t.x - e.x);
        e.contactCd = 0.25;
        e.atkT = 0.4;
        w.fx.push({ k: 'ring', x: Math.round(e.x), y: Math.round(e.y), r: 30, c: '#ff2a4a' });
      } else if (dist > e.r + 6) move(e, dx, dy, e.spd, dt);
      break;
    }

    case 'charger': {
      if (!ai.state) { ai.state = 'walk'; ai.cd = 1.5 + Math.random() * 2; }
      if (ai.state === 'walk') {
        move(e, dx, dy, e.spd, dt);
        ai.cd -= dt;
        if (ai.cd <= 0 && dist < 460) { ai.state = 'wind'; ai.wt = 0.6; e.charging = true; e.face = Math.atan2(dy, dx); }
      } else if (ai.state === 'wind') {
        ai.wt -= dt;
        if (ai.wt <= 0) { ai.state = 'charge'; ai.ct = 0.65; e.charging = false; e.contactBonus = 1.5; e.contactCd = 0; }
      } else if (ai.state === 'charge') {
        e.x += Math.cos(e.face) * e.speed * 3.8 * dt;
        e.y += Math.sin(e.face) * e.speed * 3.8 * dt;
        ai.ct -= dt;
        if (ai.ct <= 0) { ai.state = 'walk'; ai.cd = 3.5; e.contactBonus = 1; }
      }
      break;
    }

    case 'caster': {
      const want = 340;
      const radial = dist > want + 40 ? 1 : dist < want - 60 ? -1 : 0;
      if (radial) move(e, dx * radial, dy * radial, e.spd, dt);
      if (ai.cast === undefined) ai.cast = 1.5 + Math.random() * 2;
      ai.cast -= dt;
      if (ai.cast <= 0) {
        ai.cast = 4;
        if (e.ally) w.aoeEnemies(null, t.x, t.y, 70, 22, {});
        else w.spawnHazard({ kind: 'circle', x: t.x, y: t.y, r: 65, delay: 1.1, dur: 2, dps: d.dmg, color: '#b05cff' });
      }
      break;
    }
    default:
      break;
  }
}

module.exports = { ENEMIES, updateEnemy };
