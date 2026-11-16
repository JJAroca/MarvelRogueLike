// Interfaz DOM: entrada, lobby (selección, equipo, tienda Iso-8), fin de run y avisos.
import { heroSpriteKey } from './sprites.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class UI {
  constructor(S, send) {
    this.S = S;
    this.send = send;
    this.detailId = null;
    $('btn-ready').addEventListener('click', () => {
      const me = this.meInLobby();
      send({ t: 'ready', v: !(me && me.ready) });
    });
    $('btn-back').addEventListener('click', () => { S.phase = 'lobby'; this.showLobby(); });
  }

  show(id) {
    for (const s of ['join', 'lobby', 'end']) $(s).classList.toggle('hidden', s !== id);
  }

  joinError(msg) { $('join-error').textContent = msg; }
  showLobby() { this.show('lobby'); this.renderLobby(); }
  showGame() { this.show(null); }

  meInLobby() { return this.S.lobby?.players.find((p) => p.id === this.S.me); }
  isUnlocked(c) { return !c.hidden || !!this.S.profile?.unlocked[c.id]; }

  renderLobby() {
    const S = this.S;
    if (!S.profile || S.phase === 'run' && this.meInLobby()?.inRun) return;
    $('lb-code').textContent = S.code;
    $('lb-iso').textContent = S.profile.iso8;
    const me = this.meInLobby();
    const phase = S.lobby?.phase;
    $('lb-phase').textContent = phase === 'run' ? 'Run en curso: entrarás en la siguiente' : 'Elige héroe, mejora y pulsa Listo';

    // Personajes
    const myChar = me?.charId || S.selected;
    const grid = $('char-grid');
    grid.innerHTML = '';
    for (const c of S.charList) {
      const ok = this.isUnlocked(c);
      const el = document.createElement('div');
      el.className = 'char-card' + (c.id === myChar ? ' sel' : '') + (ok ? '' : ' locked');
      const spr = ok && S.sprites ? S.sprites.avatarStyle(heroSpriteKey(c.id, ''), 56) : null;
      const face = spr ? `<div class="spr" style="${spr}"></div>` : esc(c.letter);
      el.innerHTML = ok
        ? `<div class="avatar${spr ? ' has-spr' : ''}" style="background:${c.color};border-color:${c.color2};color:${c.color2}">${face}</div><div class="nm">${esc(c.name)}</div>${c.hidden ? '<span class="tag">EXTRA</span>' : ''}`
        : `<div class="avatar" style="background:#222;border-color:#444;color:#666">?</div><div class="nm">???</div><span class="tag">🔒</span>`;
      el.addEventListener('mouseenter', () => { this.detailId = c.id; this.renderDetail(); });
      el.addEventListener('click', () => {
        this.detailId = c.id;
        this.renderDetail();
        if (ok && !(me && me.ready)) { S.selected = c.id; this.send({ t: 'pick', c: c.id }); }
      });
      grid.appendChild(el);
    }
    if (!this.detailId) this.detailId = myChar;
    this.renderDetail();

    // Equipo
    const list = $('team-list');
    list.innerHTML = '';
    for (const p of S.lobby?.players || []) {
      const c = S.chars[p.charId];
      const li = document.createElement('li');
      const st = p.inRun ? 'en la run' : p.ready ? '✔ listo' : 'eligiendo…';
      li.innerHTML = `<span class="dot" style="background:${c?.color};border:2px solid ${c?.color2}"></span><div><b>${esc(p.name)}</b>${p.id === S.me ? ' <small>(tú)</small>' : ''}<br><small>${esc(c?.name || '')}</small></div><span class="st ${p.ready ? 'ok' : ''}">${st}</span>`;
      list.appendChild(li);
    }
    // Sinergias cooperativas: activas con el equipo actual y combinaciones posibles.
    const picked = new Set((S.lobby?.players || []).map((p) => p.charId));
    $('team-syn').innerHTML = (S.synergies || []).map((sy) => {
      const on = sy.need.every((c) => picked.has(c));
      const names = sy.need.map((c) => esc(S.chars[c]?.name || c)).join(' + ');
      return `<div class="syn ${on ? 'on' : ''}" style="--c:${sy.color}"><b>${on ? '🤝 ' : ''}${esc(sy.name)}</b> <small>${names}</small><br><span>${esc(sy.desc)}</span></div>`;
    }).join('');
    const btn = $('btn-ready');
    btn.disabled = phase === 'run';
    btn.textContent = me?.ready ? 'Cancelar listo' : '¡Listo!';
    btn.classList.toggle('ready-on', !!me?.ready);

    const unlockedHidden = S.charList.filter((c) => c.hidden && this.isUnlocked(c)).length;
    const st = S.profile.stats;
    $('profile-stats').innerHTML = `Perfil <b>${esc(S.profile.name)}</b><br>Runs: ${st.runs} · Victorias: ${st.wins} · Mejor piso: ${st.bestFloor}<br>Personajes ocultos: ${unlockedHidden}/5`;

    // Tienda
    const shop = $('shop-list');
    shop.innerHTML = '';
    for (const u of S.shop) {
      const el = document.createElement('div');
      el.className = 'shop-item';
      const pips = Array.from({ length: u.max }, (_, i) => `<i class="${i < u.level ? 'on' : ''}"></i>`).join('');
      const can = u.cost != null && S.profile.iso8 >= u.cost;
      el.innerHTML = `<div class="nm">${esc(u.name)} <small>Nv ${u.level}/${u.max}</small></div><div class="ds">${esc(u.desc)}</div><div class="pips">${pips}</div>`;
      const b = document.createElement('button');
      b.textContent = u.cost == null ? 'MÁX' : `◆ ${u.cost}`;
      b.disabled = !can;
      b.addEventListener('click', () => this.send({ t: 'buy', stat: u.id }));
      el.appendChild(b);
      shop.appendChild(el);
    }
  }

  renderDetail() {
    const c = this.S.chars[this.detailId];
    if (!c) return;
    const ok = this.isUnlocked(c);
    const el = $('char-detail');
    if (!ok) {
      el.innerHTML = `<h4>??? <small>(personaje oculto)</small></h4><div class="lock">🔒 Cómo desbloquearlo: ${esc(c.unlockHint)}</div>`;
      return;
    }
    el.innerHTML = `<h4 style="color:${c.color2}">${esc(c.name)}</h4><div>${esc(c.desc)}</div>
      <div class="kit">
        <div><b>Click:</b> ${esc(c.kit.attack)}</div>
        <div><b>Shift:</b> ${esc(c.kit.ability)}</div>
        <div><b>Q:</b> ${esc(c.kit.ult)}</div>
        <div><b>Pasiva:</b> ${esc(c.kit.passive)}</div>
        <div><small>Vida ${c.hp} · Velocidad ${c.speed}</small></div>
      </div>`;
  }

  showEnd(r) {
    this.show('end');
    if (!r) {
      $('end-title').textContent = 'Run terminada';
      $('end-sub').textContent = '';
      $('end-table').innerHTML = '';
      $('end-gems').innerHTML = '';
      return;
    }
    $('end-title').textContent = r.trueWin ? '¡VICTORIA VERDADERA! Con el Guantelete completo' : r.win ? '¡VICTORIA!' : 'DERROTA';
    $('end-title').style.color = r.win ? '#ffd76a' : '#ff6464';
    $('end-sub').textContent = `Piso ${r.floor} · ${r.floorName} — ${r.roomsCleared} salas, ${r.bosses} jefes, ${r.kills} enemigos${r.secretBoss ? ' · ¡Sala Secreta superada!' : ''}`;
    $('end-gems').innerHTML = this.S.gemOrder.map((g) => {
      const gm = this.S.gems[g];
      const has = r.gems.includes(g);
      return `<i title="${esc(gm.name)}" style="border-color:${gm.color};background:${has ? gm.color : 'transparent'}"></i>`;
    }).join('');
    $('end-table').innerHTML = '<tr><th>Héroe</th><th>Personaje</th><th>Bajas</th><th>Daño hecho</th><th>Daño recibido</th><th>Ítems</th><th>Iso-8</th></tr>' +
      r.players.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(this.S.chars[p.charId]?.name || '')}</td><td>${p.kills}</td><td>${p.dealt}</td><td>${p.taken}</td><td>${p.items}</td><td class="iso8">+${p.iso}</td></tr>`).join('');
  }

  toast(text, color = '#ffffff', ms = 3800) {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.style.color = color;
    el.innerHTML = `<span>${esc(text)}</span>`;
    box.appendChild(el);
    while (box.children.length > 6) box.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, ms);
  }
}
