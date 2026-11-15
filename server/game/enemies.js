'use strict';
// Enemigos normales y su IA. Los aliados (Bruja Escarlata) reutilizan la misma IA
// pero eligen como objetivo a enemigos hostiles.
//   group: cuántos aparecen juntos por cada entrada de la oleada (enjambres).
const TAU = Math.PI * 2;

const ENEMIES = {
  // Calle / laboratorio
  grunt:      { name: 'Matón callejero',      hp: 30,  r: 14, speed: 125, dmg: 10, color: '#6a4a32', ai: 'melee' },
  thief:      { name: 'Ladrón',               hp: 20,  r: 13, speed: 185, dmg: 8,  color: '#3a3f4a', ai: 'melee', bleed: true },
  kamikaze:   { name: 'Robot Kamikaze',       hp: 26,  r: 15, speed: 175, dmg: 26, color: '#8a5a3a', ai: 'kamikaze', blastR: 85 },
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

    // Robot Kamikaze: corre hacia el jugador; al contacto se arma 0,45 s y explota.
    case 'kamikaze': {
      if (ai.state === 'arm') {
        ai.armT -= dt;
        if (ai.armT <= 0) {
          const R = d.blastR || 80;
          w.fx.push({ k: 'boom', x: Math.round(e.x), y: Math.round(e.y), r: R, c: '#ff8a2a' });
          w.fx.push({ k: 'sprite', s: 'ExplosionBoom', x: Math.round(e.x), y: Math.round(e.y), sz: R * 2.2 });
          w.fx.push({ k: 'sfx', s: 'impact', x: Math.round(e.x), y: Math.round(e.y) });
          if (e.ally) w.aoeEnemies(null, e.x, e.y, R, d.dmg * 1.5, {});
          else w.enemyAoe(e, e.x, e.y, R, d.dmg, {});
          w.killEnemy(e, null, true);
        }
        break;
      }
      move(e, dx, dy, e.spd, dt);
      if (dist < e.r + (t.r || 16) + 14) { ai.state = 'arm'; ai.armT = 0.45; e.atkT = 0.45; }
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
