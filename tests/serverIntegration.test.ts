import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createFlixServer } from '../server/index';

function httpRequest(port: number, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          Connection: 'close',
          ...(payload ? { 'Content-Length': String(Buffer.byteLength(payload)) } : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 500, data: raw ? JSON.parse(raw) : {} });
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('Server Integration Test: /healthz, HTTP room lifecycle, and real-time RFC 6455 WebSocket broadcast', async () => {
  const server = createFlixServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const port = addr.port;
  let activeWsSocket: any = null;

  try {
    const health = await httpRequest(port, 'GET', '/healthz');
    assert.equal(health.status, 200);
    assert.equal(health.data.status, 'ok');
    assert.equal(health.data.service, 'flix-reversi');

    const createRes = await httpRequest(port, 'POST', '/api/rooms/create', {
      nickname: 'ServerHost',
      preferredColor: 'B',
      timerSecondsPerTurn: 30,
    });
    assert.equal(createRes.status, 200);
    assert.equal(createRes.data.ok, true);
    const roomCode = createRes.data.room.roomCode;
    const tokenHost = createRes.data.playerToken;

    const joinRes = await httpRequest(port, 'POST', '/api/rooms/join', {
      roomCode,
      nickname: 'ServerGuest',
    });
    assert.equal(joinRes.status, 200);
    assert.equal(joinRes.data.ok, true);
    assert.equal(joinRes.data.assignedColor, 'W');
    const tokenGuest = joinRes.data.playerToken;

    const wsMessages: any[] = [];
    const wsConnected = new Promise<void>((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Key': key,
          'Sec-WebSocket-Version': '13',
        },
      });
      req.on('upgrade', (_res, socket) => {
        activeWsSocket = socket;
        const msg = Buffer.from(
          JSON.stringify({ type: 'SUBSCRIBE_ROOM', roomCode, playerToken: tokenGuest }),
          'utf8'
        );
        const mask = crypto.randomBytes(4);
        const header = Buffer.alloc(6);
        header[0] = 0x81;
        header[1] = 0x80 | msg.length;
        mask.copy(header, 2);
        const maskedPayload = Buffer.alloc(msg.length);
        for (let i = 0; i < msg.length; i++) {
          maskedPayload[i] = msg[i] ^ mask[i % 4];
        }
        socket.write(Buffer.concat([header, maskedPayload]));

        socket.on('data', (buf: Buffer) => {
          let offset = 0;
          while (offset + 2 <= buf.length) {
            let len = buf[offset + 1] & 0x7f;
            let hLen = 2;
            if (len === 126) {
              len = buf.readUInt16BE(offset + 2);
              hLen = 4;
            }
            const jsonStr = buf.subarray(offset + hLen, offset + hLen + len).toString('utf8');
            offset += hLen + len;
            try {
              const parsed = JSON.parse(jsonStr);
              wsMessages.push(parsed);
              if (parsed.type === 'SUBSCRIBED') resolve();
            } catch {}
          }
        });
      });
      req.on('error', reject);
      req.end();
    });

    await wsConnected;
    assert.ok(wsMessages.some((m) => m.type === 'SUBSCRIBED'), 'Guest must receive SUBSCRIBED acknowledgement');

    const moveRes = await httpRequest(port, 'POST', '/api/rooms/move', {
      roomCode,
      playerToken: tokenHost,
      row: 2,
      col: 3,
    });
    assert.equal(moveRes.status, 200);
    assert.equal(moveRes.data.ok, true);

    await new Promise((r) => setTimeout(r, 40));
    const syncFrame = wsMessages.find((m) => m.type === 'ROOM_SYNC');
    assert.ok(syncFrame, 'WebSocket subscriber must receive ROOM_SYNC broadcast after move');
    assert.equal(syncFrame.room.gameState.blackScore, 4);
    assert.equal(syncFrame.room.gameState.currentTurn, 'W');
  } finally {
    if (activeWsSocket) {
      activeWsSocket.destroy();
    }
    if (typeof (server as any).closeAllConnections === 'function') {
      (server as any).closeAllConnections();
    }
    server.close();
  }
});
