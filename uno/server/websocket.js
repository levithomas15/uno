/* Ein kleiner WebSocket-Server nach RFC 6455 – ohne Fremdpakete.
 *
 * Er kann genau so viel, wie dieses Spiel braucht: Handschlag, Textrahmen,
 * Ping/Pong und ein sauberes Schliessen.
 */

import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 1 << 20; // 1 MiB reicht fuer jeden Spielstand

export class Connection extends EventEmitter {
  constructor(socket) {
    super();
    this.id = randomUUID();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOp = null;
    this.closed = false;
    this.alive = true;

    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('close', () => this.onClose());
    socket.on('error', () => this.onClose());
  }

  onClose() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_MESSAGE * 2) { this.close(1009); return; }

    for (;;) {
      const frame = readFrame(this.buffer);
      if (!frame) break;
      this.buffer = this.buffer.subarray(frame.size);
      this.handleFrame(frame);
      if (this.closed) break;
    }
  }

  handleFrame(frame) {
    const { opcode, fin, payload } = frame;
    switch (opcode) {
      case 0x0: // Fortsetzung
      case 0x1: // Text
      case 0x2: // Binaer (wird hier wie Text behandelt)
        if (opcode !== 0x0) this.fragmentOp = opcode;
        this.fragments.push(payload);
        if (fin) {
          const message = Buffer.concat(this.fragments).toString('utf8');
          this.fragments = [];
          this.fragmentOp = null;
          this.emit('message', message);
        }
        break;
      case 0x8: // Schliessen
        this.writeFrame(0x8, Buffer.alloc(0));
        this.socket.end();
        this.onClose();
        break;
      case 0x9: // Ping
        this.writeFrame(0xa, payload);
        break;
      case 0xa: // Pong
        this.alive = true;
        break;
      default:
        this.close(1002);
    }
  }

  send(text) {
    if (this.closed) return;
    this.writeFrame(0x1, Buffer.from(String(text), 'utf8'));
  }

  ping() {
    if (this.closed) return;
    this.alive = false;
    this.writeFrame(0x9, Buffer.alloc(0));
  }

  close(code = 1000) {
    if (this.closed) return;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code, 0);
    this.writeFrame(0x8, payload);
    this.socket.end();
    this.onClose();
  }

  writeFrame(opcode, payload) {
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode; // FIN gesetzt, keine Erweiterungen
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch {
      this.onClose();
    }
  }
}

/* Liest einen vollstaendigen Rahmen aus dem Puffer – oder nichts. */
function readFrame(buf) {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;

  if (len === 126) {
    if (buf.length < offset + 2) return null;
    len = buf.readUInt16BE(offset);
    offset += 2;
  } else if (len === 127) {
    if (buf.length < offset + 8) return null;
    const big = buf.readBigUInt64BE(offset);
    if (big > BigInt(MAX_MESSAGE)) return null;
    len = Number(big);
    offset += 8;
  }

  let mask = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    mask = buf.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buf.length < offset + len) return null;

  const payload = Buffer.from(buf.subarray(offset, offset + len));
  if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];

  return { fin, opcode, payload, size: offset + len };
}

/* Haengt den WebSocket an einen bestehenden HTTP-Server. */
export function attachWebSocket(server, path, onConnection) {
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://localhost');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== path || !key || req.headers.upgrade?.toLowerCase() !== 'websocket') {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.setNoDelay(true);
    onConnection(new Connection(socket), req);
  });
}
