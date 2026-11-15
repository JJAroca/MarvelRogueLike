'use strict';
// Punto de entrada: servidor HTTP estático + WebSocket + salas de juego.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ws = require('./ws');
const profiles = require('./profiles');
const { Room } = require('./game/room');

const PORT = Number(process.env.PORT) || 3000;
const CLIENT = path.join(__dirname, '..', 'client');
const PUBLIC = path.join(__dirname, '..', 'public');   // sprites procesados (/sprites_processed/...)
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
};

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch (e) { p = '/'; }
  if (p === '/') p = '/index.html';
  const base = p.startsWith('/sprites_processed/') || p.startsWith('/audio/') ? PUBLIC : CLIENT;
  const fp = path.normalize(path.join(base, p));
  if (!fp.startsWith(base)) { res.writeHead(403); res.end(); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const rooms = new Map();

ws.attach(server, (conn) => {
  let client = null;
  conn.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (!client) {
      if (m.t !== 'hello') return;
      const name = String(m.name || '').replace(/[<>]/g, '').trim().slice(0, 16) || 'Héroe';
      const code = String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'MARVEL';
      let room = rooms.get(code);
      if (!room) {
        room = new Room(code, () => rooms.delete(code));
        rooms.set(code, room);
      }
      const r = room.join(conn, name);
      if (r.error) {
        conn.send(JSON.stringify({ t: 'error', msg: r.error }));
        room.cleanupIfEmpty();
        return;
      }
      client = r.client;
      return;
    }
    try { client.room.onMessage(client, m); } catch (e) { console.error(e); }
  });
  conn.on('close', () => { if (client) client.room.leave(client); });
});

server.listen(PORT, () => {
  console.log(`\n  Marvel RogueLike listo en http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  En tu red local:  http://${a.address}:${PORT}`);
    }
  }
  console.log('');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { profiles.flush(); process.exit(0); });
}
process.on('exit', () => profiles.flush());
