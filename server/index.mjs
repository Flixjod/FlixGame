/**
 * FLIX REVERSI — Production HTTP + Authoritative Multiplayer Server
 * Serves the static web application, exposes /healthz for Koyeb/Render/Docker,
 * provides REST & SSE/WebSocket-compatible endpoints backed by AuthoritativeRoomStore
 * with durable file-backed snapshot persistence and graceful shutdown.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthoritativeRoomStore } from '../src/multiplayer/MultiplayerService.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_FILE = process.env.ROOM_STORE_PATH || path.join(__dirname, '..', 'data', 'rooms_snapshot.json');
const PUBLIC_HTML = path.join(__dirname, '..', 'dist', 'index.html');

const store = new AuthoritativeRoomStore();
/** @type {Map<string, Set<http.ServerResponse>>} */
const sseSubscribers = new Map();

// Rate limiter map: IP -> { count, windowStart }
const rateLimits = new Map();
const MAX_REQ_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MIN || 180);

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimits.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > 60000) {
    entry.count = 1;
    entry.windowStart = now;
  } else {
    entry.count++;
  }
  rateLimits.set(ip, entry);
  return entry.count <= MAX_REQ_PER_MINUTE;
}

// Load persisted room state if available
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(raw)) {
      for (const [code, room] of raw) {
        store.rooms.set(code, room);
      }
    }
  }
} catch (err) {
  console.warn('[Server] Could not load persisted rooms snapshot:', err.message);
}

function persistRoomsSnapshot() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify([...store.rooms.entries()]), 'utf8');
  } catch (err) {
    console.warn('[Server] Could not persist rooms snapshot:', err.message);
  }
}

function broadcastRoomEvent(roomCode, payload) {
  const subs = sseSubscribers.get(roomCode);
  if (!subs) return;
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of subs) {
    try {
      res.write(msg);
    } catch (_) {
      subs.delete(res);
    }
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 65536) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Client-Id',
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return sendJson(res, 429, { ok: false, code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' });
  }

  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  // Health check endpoint for Koyeb / Render / Docker
  if (url.pathname === '/healthz' || url.pathname === '/api/health') {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'flix-reversi',
      activeRooms: store.rooms.size,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  }

  // Real-time Server-Sent Events stream for a room
  if (req.method === 'GET' && url.pathname.startsWith('/api/rooms/') && url.pathname.endsWith('/stream')) {
    const parts = url.pathname.split('/');
    const roomCode = (parts[3] || '').toUpperCase();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    });
    res.write(`data: ${JSON.stringify({ type: 'STREAM_CONNECTED', roomCode })}\n\n`);

    if (!sseSubscribers.has(roomCode)) {
      sseSubscribers.set(roomCode, new Set());
    }
    sseSubscribers.get(roomCode).add(res);

    req.on('close', () => {
      sseSubscribers.get(roomCode)?.delete(res);
    });
    return;
  }

  try {
    if (req.method === 'POST' && url.pathname === '/api/rooms/create') {
      const body = await readJsonBody(req);
      const result = store.createRoom(body);
      if (result.ok) persistRoomsSnapshot();
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/rooms/join') {
      const body = await readJsonBody(req);
      const result = store.joinRoom(body);
      if (result.ok) {
        persistRoomsSnapshot();
        broadcastRoomEvent(result.room.roomCode, { room: result.room, events: result.event ? [result.event] : [] });
      }
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/rooms/move') {
      const body = await readJsonBody(req);
      const result = store.submitMove(body);
      if (result.ok) {
        persistRoomsSnapshot();
        broadcastRoomEvent(result.room.roomCode, { room: result.room, events: result.events });
      }
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/rooms/reconnect') {
      const body = await readJsonBody(req);
      const result = store.reconnectMember(body);
      if (result.ok) {
        persistRoomsSnapshot();
        broadcastRoomEvent(result.room.roomCode, { room: result.room, events: [] });
      }
      return sendJson(res, result.ok ? 200 : 404, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/rooms/rematch') {
      const body = await readJsonBody(req);
      const result = store.handleRematch(body);
      if (result.ok) {
        persistRoomsSnapshot();
        broadcastRoomEvent(result.room.roomCode, { room: result.room, events: result.event ? [result.event] : [] });
      }
      return sendJson(res, result.ok ? 200 : 400, result);
    }
  } catch (err) {
    return sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', message: err.message });
  }

  // Serve SPA HTML
  if (fs.existsSync(PUBLIC_HTML)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(PUBLIC_HTML).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('FLIX REVERSI frontend build not found.');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[FLIX REVERSI] Production server listening on http://${HOST}:${PORT}`);
});

function gracefulShutdown(signal) {
  console.log(`[FLIX REVERSI] Received ${signal}. Persisting room state and shutting down gracefully...`);
  persistRoomsSnapshot();
  for (const subs of sseSubscribers.values()) {
    for (const res of subs) {
      try {
        res.end();
      } catch (_) {}
    }
  }
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 4000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
