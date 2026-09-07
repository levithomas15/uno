/* Online-Partie: duenner Draht zum Server.
 *
 * Der Server fuehrt das Spiel und schickt jeder Person nur ihre eigene
 * Sicht. Dieser Client reicht Zuege weiter und meldet, was zurueckkommt.
 */

/* Wo steht der Spielserver?
 *
 * Normalerweise dort, wo auch die Seite liegt. Wird die Seite statisch
 * ausgeliefert - etwa auf GitHub Pages -, laeuft dort kein Server: dann
 * traegt man die Adresse einmal von Hand ein, und sie bleibt gespeichert. */
export function savedServer() {
  try {
    return localStorage.getItem('uno.server') || '';
  } catch {
    return '';
  }
}

export function saveServer(url) {
  try {
    if (url) localStorage.setItem('uno.server', url);
    else localStorage.removeItem('uno.server');
  } catch { /* Privater Modus: dann eben nur fuer diese Sitzung */ }
}

/* Adresse, die dieselbe Herkunft wie die Seite hat - oder null. */
export function sameOriginUrl() {
  const loc = window.location;
  if (loc.protocol === 'file:') return null;
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}/ws`;
}

export function serverUrl() {
  const saved = savedServer();
  if (saved) return saved;
  return sameOriginUrl();
}

/* Statische Hoster koennen kein WebSocket - dort hilft nur eine eigene
 * Adresse. Das erkennen wir an der Herkunft der Seite. */
export function needsOwnServer() {
  if (savedServer()) return false;
  const host = window.location.hostname || '';
  return window.location.protocol === 'file:'
    || host.endsWith('github.io')
    || host.endsWith('pages.dev')
    || host.endsWith('netlify.app')
    || host.endsWith('vercel.app');
}

export class NetClient {
  constructor() {
    this.socket = null;
    this.code = null;
    this.you = null;
    this.token = null;
    this.handlers = {};
    this.queue = [];
    this.closedByUser = false;
    this.retries = 0;
  }

  on(event, fn) { this.handlers[event] = fn; return this; }
  fire(event, data) { this.handlers[event]?.(data); }

  connect() {
    return new Promise((resolve, reject) => {
      const url = serverUrl();
      if (!url) {
        reject(new Error('Online-Spiel braucht den mitgelieferten Server (npm start) – über file:// geht es nicht.'));
        return;
      }
      let socket;
      try {
        socket = new WebSocket(url);
      } catch (err) {
        reject(new Error('Keine Verbindung zum Server.'));
        return;
      }
      this.socket = socket;
      socket.addEventListener('open', () => {
        this.retries = 0;
        for (const msg of this.queue.splice(0)) socket.send(msg);
        resolve();
      });
      socket.addEventListener('message', (event) => this.receive(event.data));
      socket.addEventListener('error', () => reject(new Error('Der Server antwortet nicht.')));
      socket.addEventListener('close', () => {
        this.socket = null;
        if (!this.closedByUser) this.reconnect();
      });
    });
  }

  /* Nach einem Abbruch zurueck an den Tisch – der Platz bleibt reserviert. */
  async reconnect() {
    if (!this.code || !this.token || this.retries > 5) {
      this.fire('closed');
      return;
    }
    this.retries += 1;
    this.fire('status', `Verbindung verloren – neuer Versuch (${this.retries}) …`);
    await new Promise((r) => setTimeout(r, 800 * this.retries));
    if (this.closedByUser) return;
    try {
      await this.connect();
      this.send({ t: 'rejoin', code: this.code, token: this.token });
    } catch {
      this.reconnect();
    }
  }

  send(msg) {
    const text = JSON.stringify(msg);
    if (this.socket && this.socket.readyState === WebSocket.OPEN) this.socket.send(text);
    else this.queue.push(text);
  }

  receive(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    switch (msg.t) {
      case 'welcome':
        this.code = msg.code;
        this.you = msg.you;
        this.token = msg.token;
        this.fire('welcome', msg);
        break;
      case 'lobby':   this.fire('lobby', msg); break;
      case 'state':   this.fire('state', msg); break;
      case 'error':   this.fire('error', msg.message); break;
      case 'toast':   this.fire('toast', msg.message); break;
      case 'closed':  this.closedByUser = true; this.fire('roomClosed', msg.message); break;
      default: break;
    }
  }

  create(name, options) { this.send({ t: 'create', name, options }); }
  join(code, name)      { this.send({ t: 'join', code, name }); }
  setOptions(options)   { this.send({ t: 'options', options }); }
  addBot(level)         { this.send({ t: 'addbot', level }); }
  removeBot()           { this.send({ t: 'rmbot' }); }
  startGame()           { this.send({ t: 'start' }); }
  action(action)        { this.send({ t: 'action', action }); }
  nextRound()           { this.send({ t: 'action', action: { type: 'next-round' } }); }

  leave() {
    this.closedByUser = true;
    this.send({ t: 'leave' });
    this.socket?.close();
    this.socket = null;
  }
}
