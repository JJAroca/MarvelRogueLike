// Cliente: red + input + estado. El servidor es autoritativo; aquí solo se
// envía el input y se interpola el último snapshot para dibujarlo.
import { UI } from './ui.js';
import { Renderer } from './render.js';
import { Sprites } from './sprites.js';
import { AudioFx } from './audio.js';

export const S = {
  sprites: new Sprites(),
  audio: new AudioFx(),
  got: null,          // último ítem recogido (aviso con icono en el HUD)
  me: 0, code: '', phase: 'join',
  chars: {}, charList: [], items: {}, gems: {}, gemOrder: [], bosses: {}, enemies: {},
  profile: null, shop: [], lobby: null, selected: 'ironman',
  snap: null, prevPos: new Map(), curPos: new Map(), snapT: 0, snapDt: 33,
  inv: [], cam: { x: 0, y: 0, scale: 1 },
  mouse: { x: 0, y: 0 },
};

let ws = null;
export function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

const ui = new UI(S, send);
const renderer = new Renderer(document.getElementById('game'), S);
S.sprites.onload = () => { if (S.phase === 'lobby') ui.renderLobby(); };

function connect(name, room) {
  // Evita una segunda conexión si se pulsa "Entrar" dos veces: el input saldría por un
  // socket distinto del que recibe los snapshots y el héroe no respondería.
  if (ws && ws.readyState <= 1) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => send({ t: 'hello', name, room });
  ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } handle(m); };
  ws.onclose = () => { if (S.phase !== 'join') ui.toast('Conexión perdida con el servidor. Recarga la página.', '#ff7a7a', 60000); };
}

function handle(m) {
  switch (m.t) {
    case 'welcome':
      S.me = m.id; S.code = m.code;
      S.charList = m.chars; S.chars = Object.fromEntries(m.chars.map((c) => [c.id, c]));
      S.items = m.items; S.gems = m.gems; S.gemOrder = m.gemOrder; S.bosses = m.bosses; S.enemies = m.enemies;
      S.profile = m.profile; S.shop = m.shop;
      S.phase = 'lobby';
      ui.showLobby();
      break;
    case 'error': ui.joinError(m.msg); ws.close(); break;
    case 'lobby': S.lobby = m; ui.renderLobby(); break;
    case 'profile': S.profile = m.profile; S.shop = m.shop; ui.renderLobby(); break;
    case 'start':
      S.phase = 'run'; S.inv = []; S.snap = null; S.prevPos.clear(); S.curPos.clear();
      ui.showGame();
      break;
    case 's': onSnap(m); break;
    case 'inv': S.inv = m.items; break;
    case 'got': S.got = { id: m.id, t: performance.now() }; break;
    case 'toast': ui.toast(m.text, m.c); break;
    case 'unlock':
      if (S.profile) S.profile.unlocked[m.id] = true;
      ui.toast(`🔓 ¡NUEVO PERSONAJE: ${S.chars[m.id]?.name || m.id}! (${m.reason})`, '#7fffb0', 7000);
      break;
    case 'end':
      S.phase = 'end'; S.profile = m.profile; S.shop = m.shop;
      ui.showEnd(m.summary);
      break;
    default: break;
  }
}

function onSnap(m) {
  const now = performance.now();
  if (S.snapT) S.snapDt = Math.min(80, Math.max(16, now - S.snapT));
  S.snapT = now;
  S.prevPos = S.curPos;
  const cur = new Map();
  for (const p of m.P) cur.set(p.i, [p.x, p.y]);
  for (const e of m.E) cur.set(e[0], [e[2], e[3]]);
  for (const r of m.R) cur.set(r[0], [r[1], r[2]]);
  for (const k of m.K) cur.set(k[0], [k[2], k[3]]);
  S.curPos = cur;
  S.snap = m;
  renderer.pushFx(m.F);
}

// Posición interpolada (entre los dos últimos snapshots).
export function lerpPos(id, x, y) {
  const prev = S.prevPos.get(id);
  if (!prev) return [x, y];
  const a = Math.min(1, (performance.now() - S.snapT) / S.snapDt);
  if (Math.abs(prev[0] - x) > 200 || Math.abs(prev[1] - y) > 200) return [x, y];
  return [prev[0] + (x - prev[0]) * a, prev[1] + (y - prev[1]) * a];
}

// ───────── Input ─────────
const keys = new Set();
const edges = { d: 0, s: 0, q: 0 };
let mouseDown = false;
// bit 16 = atacar (ratón), bit 32 = [F] mantenido (reanimar)
const KEYMAP = { KeyW: 1, ArrowUp: 1, KeyS: 2, ArrowDown: 2, KeyA: 4, ArrowLeft: 4, KeyD: 8, ArrowRight: 8, KeyF: 32 };

addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement)) ui.toast(S.audio.toggleMute() ? 'Sonido desactivado [M]' : 'Sonido activado [M]', '#cfd8ff', 1500);
  if (S.phase !== 'run') return;
  if (e.repeat) { if (KEYMAP[e.code] || e.code === 'Space') e.preventDefault(); return; }
  keys.add(e.code);
  if (e.code === 'Space') { edges.d = 1; e.preventDefault(); }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') edges.s = 1;
  if (e.code === 'KeyQ') edges.q = 1;
  if (KEYMAP[e.code]) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); mouseDown = false; });
const canvas = document.getElementById('game');
canvas.addEventListener('mousemove', (e) => { S.mouse.x = e.clientX; S.mouse.y = e.clientY; });
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) mouseDown = true;
  if (e.button === 2) edges.s = 1;
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

setInterval(() => {
  if (S.phase !== 'run' || !S.snap) return;
  let k = 0;
  for (const c of keys) k |= KEYMAP[c] || 0;
  if (mouseDown) k |= 16;
  const c = S.cam;
  const ax = (S.mouse.x - innerWidth / 2) / c.scale + c.x;
  const ay = (S.mouse.y - innerHeight / 2) / c.scale + c.y;
  send({ t: 'in', k, ax: Math.round(ax), ay: Math.round(ay), d: edges.d, s: edges.s, q: edges.q });
  edges.d = edges.s = edges.q = 0;
}, 33);

// ───────── Arranque ─────────
const nameIn = document.getElementById('in-name');
const roomIn = document.getElementById('in-room');
try {
  nameIn.value = localStorage.getItem('mrl-name') || '';
  roomIn.value = localStorage.getItem('mrl-room') || '';
} catch (e) { /* sin almacenamiento */ }
const doJoin = () => {
  const name = nameIn.value.trim();
  if (!name) { ui.joinError('Escribe un nombre de héroe.'); return; }
  try { localStorage.setItem('mrl-name', name); localStorage.setItem('mrl-room', roomIn.value.trim()); } catch (e) { /* ignore */ }
  ui.joinError('');
  connect(name, roomIn.value.trim());
};
document.getElementById('btn-join').addEventListener('click', doJoin);
for (const el of [nameIn, roomIn]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
nameIn.focus();

function frame() {
  if (S.phase === 'run' || S.phase === 'end') renderer.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
