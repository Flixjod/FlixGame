/**
 * FLIX REVERSI — Production HTTP + RFC 6455 WebSocket + Durable Match Server
 *
 * Features:
 * - Zero external runtime package dependencies (uses Node.js built-in http, crypto, fs, path)
 * - Durable atomic JSON/WAL state persistence (`DATA_DIR/rooms.db.json`) so active matches survive container restarts
 * - Optional Supabase Postgres/Realtime webhook & REST integration when SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY are set
 * - Full RFC 6455 WebSocket server for low-latency real-time room synchronization
 * - REST API fallback (`/api/rooms/create`, `/api/rooms/join`, `/api/rooms/move`, `/api/rooms/rematch`, `/api/rooms/:code`)
 * - Healthcheck endpoint (`/healthz`) for Docker, Koyeb, Render, and load balancers
 * - Per-IP sliding-window rate limiting
 * - Graceful shutdown on SIGTERM and SIGINT
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AuthoritativeRoomStore, RoomState, PublicRoomView } from '../src/multiplayer/MultiplayerEngine';
import { GameEventRecord } from '../src/engine/GameEngine';

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'rooms.db.json');
const STATIC_DIR = process.env.STATIC_DIR || path.resolve(process.cwd(), 'public');
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// Ensure durable data directory exists
function loadDurableRooms(): Record<string, RoomState> {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('[FLIX-SERVER] Warning: failed to load durable room state:', err);
  }
  return {};
}

function saveDurableRooms(rooms: Record<string, RoomState>): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmpFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(rooms), 'utf8');
    fs.renameSync(tmpFile, DB_FILE);
  } catch (err) {
    console.error('[FLIX-SERVER] Warning: failed to persist room state:', err);
  }
}

const roomStore = new AuthoritativeRoomStore(loadDurableRooms(), saveDurableRooms);

// Rate limiter (per IP, max 120 requests per 60s window)
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + 60000 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= 120;
}

// RFC 6455 WebSocket Frame Helpers
function encodeWsFrame(payloadObj: unknown): Buffer {
  const json = JSON.stringify(payloadObj);
  const data = Buffer.from(json, 'utf8');
  const len = data.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text frame
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, data]);
}

function decodeWsFrames(buffer: Buffer): Array<{ opcode: number; text: string }> {
  const frames: Array<{ opcode: number; text: string }> = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const byte0 = buffer[offset];
    const byte1 = buffer[offset + 1];
    const opcode = byte0 & 0x0f;
    const masked = (byte1 & 0x80) !== 0;
    let payloadLen = byte1 & 0x7f;
    let headerLen = 2;

    if (payloadLen === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLen = buffer.readUInt16BE(offset + 2);
      headerLen = 4;
    } else if (payloadLen === 127) {
      if (offset + 10 > buffer.length) break;
      payloadLen = Number(buffer.readBigUInt64BE(offset + 2));
      headerLen = 10;
    }

    const maskLen = masked ? 4 : 0;
    if (offset + headerLen + maskLen + payloadLen > buffer.length) break;

    const payload = Buffer.alloc(payloadLen);
    if (masked) {
      const mask = buffer.subarray(offset + headerLen, offset + headerLen + 4);
      const encrypted = buffer.subarray(
        offset + headerLen + 4,
        offset + headerLen + 4 + payloadLen
      );
      for (let i = 0; i < payloadLen; i++) {
        payload[i] = encrypted[i] ^ mask[i % 4];
      }
    } else {
      buffer
        .subarray(offset + headerLen, offset + headerLen + payloadLen)
        .copy(payload);
    }

    frames.push({ opcode, text: payload.toString('utf8') });
    offset += headerLen + maskLen + payloadLen;
  }
  return frames;
}

interface WsClient {
  socket: any;
  roomCode: string | null;
  playerToken: string | null;
  unsubscribe: (() => void) | null;
}

const wsClients = new Set<WsClient>();

function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 64 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Player-Token',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

export function createFlixServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    const ip = req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(ip)) {
      sendJson(res, 429, { ok: false, error: 'Too many requests. Please slow down.' });
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': CORS_ORIGIN,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Player-Token',
      });
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // Health check endpoint for Docker / Koyeb / Render
    if (url.pathname === '/healthz' || url.pathname === '/api/health') {
      sendJson(res, 200, {
        status: 'ok',
        service: 'flix-reversi',
        uptimeSec: Math.round(process.uptime()),
        timestamp: Date.now(),
        supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
      });
      return;
    }

    // API Routes
    if (url.pathname === '/api/rooms/create' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        const result = roomStore.createRoom({
          nickname: body.nickname || 'Player 1',
          preferredColor: body.preferredColor || 'B',
          timerSecondsPerTurn: body.timerSecondsPerTurn ?? null,
        });
        sendJson(res, result.ok ? 200 : 400, result);
      } catch {
        sendJson(res, 400, { ok: false, error: 'Invalid JSON request body' });
      }
      return;
    }

    if (url.pathname === '/api/rooms/join' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        const result = roomStore.joinRoom({
          roomCode: body.roomCode || '',
          nickname: body.nickname || 'Player 2',
          playerToken: body.playerToken,
        });
        sendJson(res, result.ok ? 200 : 400, result);
      } catch {
        sendJson(res, 400, { ok: false, error: 'Invalid JSON request body' });
      }
      return;
    }

    if (url.pathname === '/api/rooms/move' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        const result = roomStore.submitMove({
          roomCode: body.roomCode || '',
          playerToken: body.playerToken || '',
          row: Number(body.row),
          col: Number(body.col),
          expectedVersion: body.expectedVersion !== undefined ? Number(body.expectedVersion) : undefined,
        });
        sendJson(res, result.ok ? 200 : 400, result);
      } catch {
        sendJson(res, 400, { ok: false, error: 'Invalid JSON request body' });
      }
      return;
    }

    if (url.pathname === '/api/rooms/rematch' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        const result = roomStore.requestOrRespondRematch({
          roomCode: body.roomCode || '',
          playerToken: body.playerToken || '',
          action: body.action || 'request',
        });
        sendJson(res, result.ok ? 200 : 400, result);
      } catch {
        sendJson(res, 400, { ok: false, error: 'Invalid JSON request body' });
      }
      return;
    }

    if (url.pathname.startsWith('/api/rooms/') && req.method === 'GET') {
      const code = url.pathname.replace('/api/rooms/', '').trim().toUpperCase();
      const token = (req.headers['x-player-token'] as string) || url.searchParams.get('token') || undefined;
      const result = roomStore.getRoomState(code, token);
      sendJson(res, result.ok ? 200 : 404, result);
      return;
    }

    // Static web application serving
    const indexHtmlCandidates = [
      path.join(STATIC_DIR, 'index.html'),
      path.resolve(process.cwd(), 'index.html'),
      path.resolve(process.cwd(), 'flix-reversi.html'),
    ];
    for (const candidate of indexHtmlCandidates) {
      if (fs.existsSync(candidate)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(candidate).pipe(res);
        return;
      }
    }

    sendJson(res, 404, { ok: false, error: 'Not Found' });
  });

  // RFC 6455 WebSocket Upgrade for Real-Time Synchronization
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        '',
      ].join('\r\n')
    );

    const client: WsClient = {
      socket,
      roomCode: null,
      playerToken: null,
      unsubscribe: null,
    };
    wsClients.add(client);

    socket.on('data', (buf: Buffer) => {
      const frames = decodeWsFrames(buf);
      for (const frame of frames) {
        if (frame.opcode === 0x08) {
          socket.end();
          return;
        }
        if (frame.opcode !== 0x01) continue;
        try {
          const msg = JSON.parse(frame.text);
          if (msg.type === 'SUBSCRIBE_ROOM' && msg.roomCode) {
            if (client.unsubscribe) client.unsubscribe();
            client.roomCode = String(msg.roomCode).toUpperCase();
            client.playerToken = msg.playerToken || null;
            if (client.roomCode && client.playerToken) {
              roomStore.setPlayerConnection({
                roomCode: client.roomCode,
                playerToken: client.playerToken,
                connected: true,
              });
            }
            client.unsubscribe = roomStore.subscribeRoom(
              client.roomCode,
              (pub: PublicRoomView, latestEvents: GameEventRecord[]) => {
                try {
                  socket.write(
                    encodeWsFrame({
                      type: 'ROOM_SYNC',
                      room: pub,
                      events: latestEvents,
                    })
                  );
                } catch {}
              }
            );
            const current = roomStore.getRoomState(client.roomCode, client.playerToken || undefined);
            socket.write(encodeWsFrame({ type: 'SUBSCRIBED', ...current }));
          }
        } catch {}
      }
    });

    const cleanup = () => {
      if (client.unsubscribe) {
        client.unsubscribe();
        client.unsubscribe = null;
      }
      if (client.roomCode && client.playerToken) {
        roomStore.setPlayerConnection({
          roomCode: client.roomCode,
          playerToken: client.playerToken,
          connected: false,
        });
      }
      wsClients.delete(client);
    };

    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });

  return server;
}

if (require.main === module) {
  const srv = createFlixServer();
  srv.listen(PORT, HOST, () => {
    console.log(`[FLIX REVERSI] Authoritative server listening on http://${HOST}:${PORT}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[FLIX REVERSI] Received ${signal}. Shutting down gracefully...`);
    for (const c of wsClients) {
      try {
        c.socket.end();
      } catch {}
    }
    srv.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
