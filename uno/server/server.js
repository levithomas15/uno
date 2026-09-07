/* Server fuer die Online-Partie.
 *
 * Liefert die Seite aus und fuehrt die Spiele: pro Raum ein Spielstand,
 * jede Person bekommt nur ihre eigene Sicht. Der Server glaubt keinem
 * Client - jeder Zug laeuft durch dasselbe Regelwerk wie im Browser.
 *
 *   node server/server.js            -> http://localhost:8080
 *   PORT=3000 node server/server.js
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { attachWebSocket } from './websocket.js';
import { createGame, applyAction, viewFor, DEFAULT_OPTIONS } from '../js/engine.js';
import { botAction, botCatch } from '../js/bot.js';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const MAX_PLAYERS = 10;
const BOT_DELAY = 900;
const BOT_CATCH_DELAY = 1500;
const AWAY_TIMEOUT = 20000;              // so lange wartet der Tisch auf Abwesende
const ROOM_IDLE = 2 * 60 * 60 * 1000;    // danach macht ein stiller Raum zu

/* ------------------------------------------------------------ Dateiausgabe */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function serveFile(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';

    // Kein Ausbrechen aus dem Spielordner.
    const target = join(ROOT, normalize(path));
    if (!target.startsWith(ROOT)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Verboten');
      return;
    }

    const info = await stat(target);
    if (info.isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
      return;
    }

    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[extname(target)] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
  }
}

/* ------------------------------------------------------------------ Raeume */

/** @type {Map<string, Room>} */
export const rooms = new Map();

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne I, O, 0, 1
function newCode() {
  for (;;) {
    const bytes = randomBytes(4);
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (!rooms.has(code)) return code;
  }
}

const BOT_NAMES = ['Ada', 'Bruno', 'Carla', 'Deniz', 'Ella', 'Franz', 'Gina', 'Hakan', 'Ida'];

function cleanName(name, index) {
  const clean = String(name ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14);
  return clean || `Spieler ${index + 1}`;
}

function sanitizeOptions(options = {}) {
  const allowed = [500, 300, 0];
  const target = Number(options.targetScore);
  return {
    targetScore: allowed.includes(target) ? target : 500,
    challenge: options.challenge !== false,
    stacking: !!options.stacking,
    drawUntilPlayable: !!options.drawUntilPlayable,
  };
}

export class Room {
  constructor(code, options) {
    this.code = code;
    this.options = { ...DEFAULT_OPTIONS, ...sanitizeOptions(options) };
    this.players = [];   // { id, name, isBot, botLevel, token, conn, connected }
    this.hostId = null;
    this.game = null;
    this.timer = null;
    this.awayTimer = null;
    this.touched = Date.now();
  }

  get started() { return this.game !== null; }

  add({ name, isBot = false, botLevel = 'normal', conn = null }) {
    const player = {
      id: `s${this.players.length}-${randomBytes(3).toString('hex')}`,
      name: cleanName(name, this.players.length),
      isBot,
      botLevel,
      token: randomBytes(12).toString('hex'),
      conn,
      connected: isBot ? true : !!conn,
    };
    this.players.push(player);
    if (!this.hostId && !isBot) this.hostId = player.id;
    return player;
  }

  remove(playerId) {
    const idx = this.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return;
    this.players.splice(idx, 1);
    if (this.hostId === playerId) {
      this.hostId = this.players.find((p) => !p.isBot)?.id ?? null;
    }
  }

  byConn(conn) { return this.players.find((p) => p.conn === conn) ?? null; }
  seatOf(playerId) { return this.players.findIndex((p) => p.id === playerId); }

  send(player, msg) {
    if (!player.conn || !player.connected) return;
    try { player.conn.send(JSON.stringify(msg)); } catch { /* Leitung weg */ }
  }

  broadcast(msg) {
    for (const p of this.players) this.send(p, msg);
  }

  lobbyMessage() {
    return {
      t: 'lobby',
      code: this.code,
      host: this.hostId,
      started: this.started,
      options: this.options,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, isBot: p.isBot, connected: p.connected,
      })),
    };
  }

  sendLobby() { this.broadcast(this.lobbyMessage()); }

  /* Jede Person sieht ihre eigene Hand und sonst nur Kartenzahlen. */
  sendState() {
    if (!this.game) return;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.isBot || !p.conn) continue;
      this.send(p, { t: 'state', view: viewFor(this.game, i) });
    }
  }

  start() {
    this.game = createGame({
      players: this.players.map((p) => ({
        id: p.id, name: p.name, isBot: p.isBot, botLevel: p.botLevel,
      })),
      options: this.options,
    });
    this.syncConnected();
    this.sendLobby();
    this.sendState();
    this.schedule();
  }

  syncConnected() {
    if (!this.game) return;
    for (let i = 0; i < this.players.length; i++) {
      if (!this.game.players[i]) continue;
      this.game.players[i].connected = this.players[i].connected;
      this.game.players[i].name = this.players[i].name;
    }
  }

  actorIndex() {
    const g = this.game;
    if (!g) return null;
    if (g.phase === 'challenge' && g.pendingWild4) return g.pendingWild4.target;
    if (g.phase === 'round-over' || g.phase === 'game-over') return null;
    return g.current;
  }

  /* Ein Zug von einer Person. Zurueck kommt nur ein Text, wenn er nicht passt. */
  play(playerId, action) {
    if (!this.game) return 'Das Spiel laeuft noch nicht.';
    const seat = this.seatOf(playerId);
    if (seat === -1) return 'Du sitzt nicht an diesem Tisch.';

    const res = applyAction(this.game, seat, action);
    if (!res.ok) return res.error;
    this.sendState();
    this.schedule();
    return null;
  }

  /* Bots ziehen zeitversetzt; wer weg ist, wird nach einer Weile vertreten. */
  schedule() {
    clearTimeout(this.timer);
    clearTimeout(this.awayTimer);
    if (!this.game || this.game.phase === 'game-over') return;

    if (this.game.unoVulnerable !== null) {
      setTimeout(() => {
        const g = this.game;
        if (!g || g.unoVulnerable === null || !rooms.has(this.code)) return;
        for (let i = 0; i < this.players.length; i++) {
          if (!this.players[i].isBot) continue;
          const c = botCatch(g, i);
          if (c) { applyAction(g, i, c); this.sendState(); break; }
        }
      }, BOT_CATCH_DELAY);
    }

    const actor = this.actorIndex();
    if (actor === null) return;

    const player = this.players[actor];
    if (player.isBot) {
      this.timer = setTimeout(() => this.autoMove(actor), BOT_DELAY);
      return;
    }
    if (!player.connected) {
      // Niemand soll auf eine abgerissene Verbindung warten muessen.
      this.awayTimer = setTimeout(() => {
        if (this.players[actor]?.connected) return;
        this.autoMove(actor, `${player.name} ist offline - der Tisch spielt weiter.`);
      }, AWAY_TIMEOUT);
    }
  }

  autoMove(seat, note) {
    const g = this.game;
    if (!g || !rooms.has(this.code)) return;
    if (this.actorIndex() !== seat) return;
    const action = botAction(g, seat) || { type: 'draw' };
    const res = applyAction(g, seat, action);
    if (!res.ok) applyAction(g, seat, { type: 'draw' });
    if (note) this.broadcast({ t: 'toast', message: note });
    this.sendState();
    this.schedule();
  }

  close(message) {
    clearTimeout(this.timer);
    clearTimeout(this.awayTimer);
    this.broadcast({ t: 'closed', message: message || 'Der Raum wurde geschlossen.' });
    rooms.delete(this.code);
  }
}

/* --------------------------------------------------------------- Nachrichten */

function fail(conn, message) {
  try { conn.send(JSON.stringify({ t: 'error', message })); } catch { /* egal */ }
}

function welcome(room, player) {
  room.send(player, { t: 'welcome', code: room.code, you: player.id, token: player.token });
  room.sendLobby();
  if (room.started) room.sendState();
}

export function handleMessage(conn, session, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || typeof msg.t !== 'string') return;

  const room = session.room;
  const player = room ? room.byConn(conn) : null;
  if (room) room.touched = Date.now();

  const hostOnly = () => {
    if (!room || !player || room.hostId !== player.id) { fail(conn, 'Das darf nur der Gastgeber.'); return false; }
    if (room.started) { fail(conn, 'Die Partie laeuft schon.'); return false; }
    return true;
  };

  switch (msg.t) {
    case 'create': {
      if (room) { fail(conn, 'Du sitzt schon an einem Tisch.'); return; }
      const created = new Room(newCode(), msg.options);
      const host = created.add({ name: msg.name, conn });
      rooms.set(created.code, created);
      session.room = created;
      welcome(created, host);
      break;
    }

    case 'join': {
      if (room) { fail(conn, 'Du sitzt schon an einem Tisch.'); return; }
      const code = String(msg.code || '').toUpperCase().trim();
      const target = rooms.get(code);
      if (!target) { fail(conn, 'Diesen Raum gibt es nicht.'); return; }
      if (target.started) { fail(conn, 'Dort laeuft schon eine Partie.'); return; }
      if (target.players.length >= MAX_PLAYERS) { fail(conn, 'Der Tisch ist voll (10 Plaetze).'); return; }
      const joined = target.add({ name: msg.name, conn });
      session.room = target;
      welcome(target, joined);
      target.broadcast({ t: 'toast', message: `${joined.name} kommt dazu.` });
      break;
    }

    case 'rejoin': {
      const target = rooms.get(String(msg.code || '').toUpperCase());
      const seatPlayer = target ? target.players.find((p) => p.token === msg.token) : null;
      if (!target || !seatPlayer) { fail(conn, 'Der Platz ist nicht mehr frei.'); return; }
      seatPlayer.conn = conn;
      seatPlayer.connected = true;
      session.room = target;
      target.syncConnected();
      welcome(target, seatPlayer);
      target.broadcast({ t: 'toast', message: `${seatPlayer.name} ist zurueck.` });
      target.schedule();
      break;
    }

    case 'options': {
      if (!hostOnly()) return;
      room.options = { ...DEFAULT_OPTIONS, ...sanitizeOptions(msg.options) };
      room.sendLobby();
      break;
    }

    case 'addbot': {
      if (!hostOnly()) return;
      if (room.players.length >= MAX_PLAYERS) { fail(conn, 'Der Tisch ist voll.'); return; }
      const level = ['easy', 'normal', 'hard'].includes(msg.level) ? msg.level : 'normal';
      const used = room.players.filter((p) => p.isBot).length;
      room.add({ name: BOT_NAMES[used % BOT_NAMES.length], isBot: true, botLevel: level });
      room.sendLobby();
      break;
    }

    case 'rmbot': {
      if (!hostOnly()) return;
      const last = [...room.players].reverse().find((p) => p.isBot);
      if (last) room.remove(last.id);
      room.sendLobby();
      break;
    }

    case 'start': {
      if (!hostOnly()) return;
      if (room.players.length < 2) { fail(conn, 'Zu zweit geht es los - es fehlt noch jemand.'); return; }
      room.start();
      break;
    }

    case 'action': {
      if (!room || !player) { fail(conn, 'Du sitzt an keinem Tisch.'); return; }
      const error = room.play(player.id, msg.action);
      if (error) fail(conn, error);
      break;
    }

    case 'leave':
      dropConnection(conn, session, true);
      break;

    default:
      break;
  }
}

/* Verbindung weg: im Warteraum verschwindet der Platz, im laufenden Spiel
 * bleibt er reserviert, damit man zurueckkommen kann. */
export function dropConnection(conn, session, deliberate) {
  const room = session.room;
  if (!room) return;
  const player = room.byConn(conn);
  session.room = null;
  if (!player) return;

  player.conn = null;
  player.connected = false;

  if (room.started) {
    if (deliberate) room.remove(player.id);
    room.syncConnected();
    room.broadcast({
      t: 'toast',
      message: deliberate ? `${player.name} verlaesst den Tisch.` : `${player.name} hat die Verbindung verloren.`,
    });
    room.sendState();
    room.schedule();
  } else {
    room.remove(player.id);
    room.broadcast({ t: 'toast', message: `${player.name} ist weg.` });
  }

  const humansLeft = room.players.some((p) => !p.isBot && p.connected);
  if (room.players.length === 0 || (!humansLeft && !room.started)) {
    room.close('Der Raum ist leer.');
    return;
  }
  room.sendLobby();
}

/* ------------------------------------------------------------------ Aufbau */

export const server = createServer(serveFile);

attachWebSocket(server, '/ws', (conn) => {
  const session = { room: null };
  conn.on('message', (raw) => handleMessage(conn, session, raw));
  conn.on('close', () => dropConnection(conn, session, false));
});

// Tote Verbindungen erkennen und stille Raeume aufraeumen.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    for (const p of room.players) if (p.conn && p.connected) p.conn.ping();
    if (now - room.touched > ROOM_IDLE) room.close('Der Raum wurde wegen Untaetigkeit geschlossen.');
    else if (room.players.length === 0) rooms.delete(code);
  }
}, 30000);
sweeper.unref();

if (process.env.UNO_NO_LISTEN !== '1') {
  server.listen(PORT, HOST, () => {
    console.log(`UNO laeuft auf http://localhost:${PORT}`);
    console.log(`Im selben WLAN: http://<IP-dieses-Rechners>:${PORT}`);
  });
}
