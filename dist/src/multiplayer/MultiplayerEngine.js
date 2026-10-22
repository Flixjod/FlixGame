"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MultiplayerClientSession = exports.AuthoritativeRoomStore = void 0;
exports.sanitizeRoomForClient = sanitizeRoomForClient;
var _GameEngine = require("../engine/GameEngine");
/**
 * FLIX REVERSI — Authoritative Multiplayer Room Store & Synchronization Service
 */

const ROOM_TTL_MS = 1000 * 60 * 60 * 4;
const REMATCH_TIMEOUT_MS = 30000;
function sanitizeRoomForClient(room) {
  const stripToken = p => {
    if (!p) return null;
    return {
      playerId: p.playerId,
      nickname: p.nickname,
      color: p.color,
      connected: p.connected,
      lastSeenAt: p.lastSeenAt
    };
  };
  return {
    roomCode: room.roomCode,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    expiresAt: room.expiresAt,
    timerSecondsPerTurn: room.timerSecondsPerTurn,
    turnStartedAt: room.turnStartedAt,
    players: {
      B: stripToken(room.players.B),
      W: stripToken(room.players.W)
    },
    gameState: room.gameState,
    rematch: {
      ...room.rematch
    },
    events: [...room.events],
    version: room.version
  };
}
class AuthoritativeRoomStore {
  rooms = new Map();
  subscribers = new Map();
  constructor(initialRooms, onPersist) {
    if (initialRooms) {
      for (const [code, r] of Object.entries(initialRooms)) {
        this.rooms.set(code.toUpperCase(), r);
      }
    }
    this.onPersist = onPersist;
  }
  persist() {
    if (this.onPersist) {
      const obj = {};
      for (const [k, v] of this.rooms.entries()) {
        obj[k] = v;
      }
      this.onPersist(obj);
    }
  }
  generateRoomCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 25; attempt++) {
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    return `R${Date.now().toString(36).slice(-5).toUpperCase()}`;
  }
  generateToken(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  }
  createRoom(options) {
    const now = options.now ?? Date.now();
    const roomCode = (options.customCode ?? this.generateRoomCode()).toUpperCase();
    const nickname = (options.nickname || 'Player 1').trim().slice(0, 24);
    const assignedColor = options.preferredColor === 'W' ? 'W' : options.preferredColor === 'random' ? Math.random() < 0.5 ? 'B' : 'W' : 'B';
    const playerId = this.generateToken('plr');
    const playerToken = this.generateToken('sec');
    const hostPlayer = {
      playerId,
      playerToken,
      nickname,
      color: assignedColor,
      connected: true,
      joinedAt: now,
      lastSeenAt: now
    };
    const gameState = (0, _GameEngine.createNewGame)({
      id: `online_${roomCode}_1`,
      now
    });
    const createEvent = {
      eventId: `room_${roomCode}_created_${now}`,
      type: 'TURN_CHANGED',
      timestamp: now,
      payload: {
        roomCode,
        hostNickname: nickname,
        assignedColor
      }
    };
    const room = {
      roomCode,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + ROOM_TTL_MS,
      hostPlayerId: playerId,
      timerSecondsPerTurn: options.timerSecondsPerTurn ?? null,
      turnStartedAt: null,
      players: {
        B: assignedColor === 'B' ? hostPlayer : null,
        W: assignedColor === 'W' ? hostPlayer : null
      },
      gameState,
      rematch: {
        status: 'none',
        requestedBy: null,
        requestedAt: null,
        expiresAt: null
      },
      events: [createEvent],
      version: 1
    };
    this.rooms.set(roomCode, room);
    this.persist();
    const pub = sanitizeRoomForClient(room);
    this.notifySubscribers(roomCode, pub, [createEvent]);
    return {
      ok: true,
      room: pub,
      playerId,
      playerToken,
      assignedColor,
      events: [createEvent]
    };
  }
  joinRoom(options) {
    const now = options.now ?? Date.now();
    const code = (options.roomCode || '').trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      return {
        ok: false,
        code: 'INVALID_ROOM',
        error: `Room "${code}" does not exist.`
      };
    }
    if (now > room.expiresAt) {
      this.rooms.delete(code);
      this.persist();
      return {
        ok: false,
        code: 'EXPIRED_ROOM',
        error: `Room "${code}" has expired.`
      };
    }
    if (options.playerToken) {
      for (const color of ['B', 'W']) {
        const existing = room.players[color];
        if (existing && existing.playerToken === options.playerToken) {
          existing.connected = true;
          existing.lastSeenAt = now;
          room.updatedAt = now;
          room.version += 1;
          this.persist();
          const pub = sanitizeRoomForClient(room);
          this.notifySubscribers(code, pub, []);
          return {
            ok: true,
            room: pub,
            playerId: existing.playerId,
            playerToken: existing.playerToken,
            assignedColor: color,
            events: []
          };
        }
      }
    }
    const openColor = !room.players.B ? 'B' : !room.players.W ? 'W' : null;
    if (!openColor) {
      return {
        ok: false,
        code: 'ROOM_FULL',
        error: `Room "${code}" is already full (2/2 players).`
      };
    }
    const playerId = this.generateToken('plr');
    const playerToken = this.generateToken('sec');
    const nickname = (options.nickname || 'Player 2').trim().slice(0, 24);
    room.players[openColor] = {
      playerId,
      playerToken,
      nickname,
      color: openColor,
      connected: true,
      joinedAt: now,
      lastSeenAt: now
    };
    room.updatedAt = now;
    room.turnStartedAt = now;
    room.version += 1;
    const joinEvent = {
      eventId: `room_${code}_join_${playerId}`,
      type: 'TURN_CHANGED',
      timestamp: now,
      payload: {
        roomCode: code,
        joinedPlayer: nickname,
        assignedColor: openColor,
        activePlayer: room.gameState.currentTurn
      }
    };
    room.events.push(joinEvent);
    this.persist();
    const pub = sanitizeRoomForClient(room);
    this.notifySubscribers(code, pub, [joinEvent]);
    return {
      ok: true,
      room: pub,
      playerId,
      playerToken,
      assignedColor: openColor,
      events: [joinEvent]
    };
  }
  submitMove(options) {
    const now = options.now ?? Date.now();
    const code = (options.roomCode || '').trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      return {
        ok: false,
        code: 'INVALID_ROOM',
        error: 'Room not found.'
      };
    }
    if (now > room.expiresAt) {
      return {
        ok: false,
        code: 'EXPIRED_ROOM',
        error: 'Room has expired.'
      };
    }
    let memberColor = null;
    if (room.players.B?.playerToken === options.playerToken) memberColor = 'B';else if (room.players.W?.playerToken === options.playerToken) memberColor = 'W';
    if (!memberColor) {
      return {
        ok: false,
        code: 'UNAUTHORIZED',
        error: 'Unauthorized: invalid room membership token.'
      };
    }
    if (!room.players.B || !room.players.W) {
      return {
        ok: false,
        code: 'NOT_READY',
        error: 'Waiting for opponent to join before making moves.'
      };
    }
    if (options.expectedVersion !== undefined && options.expectedVersion !== room.gameState.version) {
      return {
        ok: false,
        code: 'STALE_STATE',
        error: 'Client state is out of date with authoritative server state.',
        room: sanitizeRoomForClient(room)
      };
    }
    const result = (0, _GameEngine.applyMove)(room.gameState, options.row, options.col, memberColor, now);
    if (!result.accepted) {
      return {
        ok: false,
        code: 'ILLEGAL_MOVE',
        error: result.error || 'Illegal move rejected by authoritative server.',
        room: sanitizeRoomForClient(room),
        events: result.events
      };
    }
    room.gameState = result.state;
    room.updatedAt = now;
    room.turnStartedAt = result.state.status === 'playing' ? now : null;
    room.version += 1;
    room.players[memberColor].lastSeenAt = now;
    room.events.push(...result.events);
    this.persist();
    const pub = sanitizeRoomForClient(room);
    this.notifySubscribers(code, pub, result.events);
    return {
      ok: true,
      room: pub,
      assignedColor: memberColor,
      events: result.events
    };
  }
  setPlayerConnection(options) {
    const now = options.now ?? Date.now();
    const code = (options.roomCode || '').trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      return {
        ok: false,
        code: 'INVALID_ROOM',
        error: 'Room not found.'
      };
    }
    let member = null;
    if (room.players.B?.playerToken === options.playerToken) member = room.players.B;else if (room.players.W?.playerToken === options.playerToken) member = room.players.W;
    if (!member) {
      return {
        ok: false,
        code: 'UNAUTHORIZED',
        error: 'Invalid player token.'
      };
    }
    member.connected = options.connected;
    member.lastSeenAt = now;
    room.updatedAt = now;
    room.version += 1;
    if (!options.connected && room.rematch.status === 'pending') {
      room.rematch.status = 'declined';
    }
    this.persist();
    const pub = sanitizeRoomForClient(room);
    this.notifySubscribers(code, pub, []);
    return {
      ok: true,
      room: pub,
      assignedColor: member.color
    };
  }
  requestOrRespondRematch(options) {
    const now = options.now ?? Date.now();
    const code = (options.roomCode || '').trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      return {
        ok: false,
        code: 'INVALID_ROOM',
        error: 'Room not found.'
      };
    }
    let memberColor = null;
    if (room.players.B?.playerToken === options.playerToken) memberColor = 'B';else if (room.players.W?.playerToken === options.playerToken) memberColor = 'W';
    if (!memberColor) {
      return {
        ok: false,
        code: 'UNAUTHORIZED',
        error: 'Unauthorized player token.'
      };
    }
    const opponentColor = (0, _GameEngine.getOpponentColor)(memberColor);
    const opponent = room.players[opponentColor];
    if (options.action === 'request') {
      if (!opponent || !opponent.connected) {
        room.rematch = {
          status: 'declined',
          requestedBy: memberColor,
          requestedAt: now,
          expiresAt: null
        };
        return {
          ok: false,
          error: 'Opponent is disconnected and cannot accept a rematch.',
          room: sanitizeRoomForClient(room)
        };
      }
      if (room.rematch.status === 'pending' && room.rematch.requestedBy === opponentColor) {
        return this.requestOrRespondRematch({
          ...options,
          action: 'accept',
          now
        });
      }
      room.rematch = {
        status: 'pending',
        requestedBy: memberColor,
        requestedAt: now,
        expiresAt: now + REMATCH_TIMEOUT_MS
      };
      room.updatedAt = now;
      room.version += 1;
      this.persist();
      const pub = sanitizeRoomForClient(room);
      this.notifySubscribers(code, pub, []);
      return {
        ok: true,
        room: pub,
        assignedColor: memberColor
      };
    }
    if (options.action === 'decline') {
      room.rematch = {
        status: 'declined',
        requestedBy: room.rematch.requestedBy,
        requestedAt: room.rematch.requestedAt,
        expiresAt: null
      };
      room.updatedAt = now;
      room.version += 1;
      this.persist();
      const pub = sanitizeRoomForClient(room);
      this.notifySubscribers(code, pub, []);
      return {
        ok: true,
        room: pub,
        assignedColor: memberColor
      };
    }
    if (room.rematch.status === 'pending' && room.rematch.expiresAt && now > room.rematch.expiresAt) {
      room.rematch.status = 'timeout';
      room.updatedAt = now;
      room.version += 1;
      this.persist();
      const pub = sanitizeRoomForClient(room);
      this.notifySubscribers(code, pub, []);
      return {
        ok: false,
        error: 'Rematch request timed out.',
        room: pub
      };
    }
    room.rematch = {
      status: 'accepted',
      requestedBy: room.rematch.requestedBy,
      requestedAt: room.rematch.requestedAt,
      expiresAt: null
    };
    const matchIndex = room.version + 1;
    room.gameState = (0, _GameEngine.createNewGame)({
      id: `online_${code}_${matchIndex}`,
      now
    });
    room.turnStartedAt = now;
    room.updatedAt = now;
    room.version += 1;
    const resetEvent = {
      eventId: `room_${code}_rematch_${room.version}`,
      type: 'TURN_CHANGED',
      timestamp: now,
      payload: {
        rematchAccepted: true,
        activePlayer: 'B'
      }
    };
    room.events.push(resetEvent);
    this.persist();
    const pub = sanitizeRoomForClient(room);
    this.notifySubscribers(code, pub, [resetEvent]);
    return {
      ok: true,
      room: pub,
      assignedColor: memberColor,
      events: [resetEvent]
    };
  }
  checkRematchTimeout(roomCode, now = Date.now()) {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) return null;
    if (room.rematch.status === 'pending' && room.rematch.expiresAt && now > room.rematch.expiresAt) {
      room.rematch.status = 'timeout';
      room.updatedAt = now;
      room.version += 1;
      this.persist();
      const pub = sanitizeRoomForClient(room);
      this.notifySubscribers(code, pub, []);
      return pub;
    }
    return sanitizeRoomForClient(room);
  }
  getRoomState(roomCode, playerToken, now = Date.now()) {
    const code = (roomCode || '').trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      return {
        ok: false,
        code: 'INVALID_ROOM',
        error: `Room "${code}" is unavailable or does not exist.`
      };
    }
    if (now > room.expiresAt) {
      this.rooms.delete(code);
      this.persist();
      return {
        ok: false,
        code: 'EXPIRED_ROOM',
        error: `Room "${code}" has expired.`
      };
    }
    if (playerToken) {
      const isB = room.players.B?.playerToken === playerToken;
      const isW = room.players.W?.playerToken === playerToken;
      if (!isB && !isW) {
        return {
          ok: false,
          code: 'UNAUTHORIZED',
          error: 'You are not a member of this room.'
        };
      }
      const assignedColor = isB ? 'B' : 'W';
      return {
        ok: true,
        room: sanitizeRoomForClient(room),
        assignedColor,
        playerId: room.players[assignedColor].playerId,
        playerToken
      };
    }
    return {
      ok: true,
      room: sanitizeRoomForClient(room)
    };
  }
  subscribeRoom(roomCode, callback) {
    const code = roomCode.trim().toUpperCase();
    if (!this.subscribers.has(code)) {
      this.subscribers.set(code, new Set());
    }
    this.subscribers.get(code).add(callback);
    return () => {
      const set = this.subscribers.get(code);
      if (set) set.delete(callback);
    };
  }
  notifySubscribers(roomCode, pub, latestEvents) {
    const subs = this.subscribers.get(roomCode);
    if (!subs) return;
    for (const fn of subs) {
      fn(pub, latestEvents);
    }
  }
}
exports.AuthoritativeRoomStore = AuthoritativeRoomStore;
class MultiplayerClientSession {
  roomCode = null;
  playerToken = null;
  playerId = null;
  assignedColor = null;
  connectionStatus = 'Connecting';
  roomSnapshot = null;
  unsubscribeStore = null;
  statusListeners = new Set();
  retryAttempt = 0;
  constructor(store, eventManager, reconnectConfig = {
    maxRetries: 4,
    baseDelayMs: 50,
    maxDelayMs: 800
  }) {
    this.store = store;
    this.eventManager = eventManager;
    this.reconnectConfig = reconnectConfig;
  }
  onStatusChange(fn) {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }
  getConnectionStatus() {
    return this.connectionStatus;
  }
  getRoomSnapshot() {
    return this.roomSnapshot;
  }
  getAssignedColor() {
    return this.assignedColor;
  }
  getPlayerToken() {
    return this.playerToken;
  }
  setStatus(status) {
    this.connectionStatus = status;
    this.eventManager.emit({
      eventId: `conn_${this.roomCode ?? 'global'}_${status}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: 'CONNECTION_STATE_CHANGED',
      timestamp: Date.now(),
      payload: {
        status,
        roomCode: this.roomCode
      }
    });
    for (const fn of this.statusListeners) {
      fn(status, this.roomSnapshot);
    }
  }
  createPrivateRoom(options) {
    this.cleanupSubscription();
    this.setStatus('Connecting');
    const res = this.store.createRoom(options);
    if (!res.ok || !res.room) {
      this.setStatus('Connection Failed');
      return res;
    }
    this.roomCode = res.room.roomCode;
    this.playerToken = res.playerToken ?? null;
    this.playerId = res.playerId ?? null;
    this.assignedColor = res.assignedColor ?? null;
    this.roomSnapshot = res.room;
    for (const ev of res.room.events) {
      this.eventManager.emit({
        ...ev,
        suppressEffects: true
      });
    }
    this.bindRoomSubscription(this.roomCode);
    this.setStatus('Connected');
    return res;
  }
  joinExistingRoom(options) {
    this.cleanupSubscription();
    this.setStatus('Connecting');
    const res = this.store.joinRoom({
      roomCode: options.roomCode,
      nickname: options.nickname,
      now: options.now
    });
    if (!res.ok || !res.room) {
      this.setStatus(res.code === 'INVALID_ROOM' || res.code === 'EXPIRED_ROOM' ? 'Match Unavailable' : 'Connection Failed');
      return res;
    }
    this.roomCode = res.room.roomCode;
    this.playerToken = res.playerToken ?? null;
    this.playerId = res.playerId ?? null;
    this.assignedColor = res.assignedColor ?? null;
    this.roomSnapshot = res.room;
    for (const ev of res.room.events) {
      this.eventManager.emit({
        ...ev,
        suppressEffects: true
      });
    }
    this.bindRoomSubscription(this.roomCode);
    this.setStatus('Connected');
    return res;
  }
  makeMove(row, col, now) {
    if (!this.roomCode || !this.playerToken) {
      return {
        ok: false,
        code: 'UNAUTHORIZED',
        error: 'Not connected to a room.'
      };
    }
    return this.store.submitMove({
      roomCode: this.roomCode,
      playerToken: this.playerToken,
      row,
      col,
      expectedVersion: this.roomSnapshot?.gameState.version,
      now
    });
  }
  simulateDisconnect(now) {
    if (!this.roomCode || !this.playerToken) return;
    this.cleanupSubscription();
    this.store.setPlayerConnection({
      roomCode: this.roomCode,
      playerToken: this.playerToken,
      connected: false,
      now
    });
    this.setStatus('Reconnecting');
  }
  async reconnectWithBackoff(simulateTransportFailureAttempts = 0, now) {
    if (!this.roomCode || !this.playerToken) {
      this.setStatus('Match Unavailable');
      return {
        ok: false,
        code: 'UNAUTHORIZED',
        error: 'Missing room credentials for reconnection.'
      };
    }
    this.cleanupSubscription();
    this.setStatus('Reconnecting');
    this.retryAttempt = 0;
    while (this.retryAttempt <= this.reconnectConfig.maxRetries) {
      if (this.retryAttempt > 0) {
        const backoff = Math.min(this.reconnectConfig.maxDelayMs, this.reconnectConfig.baseDelayMs * Math.pow(2, this.retryAttempt - 1));
        await new Promise(r => setTimeout(r, backoff));
      }
      this.retryAttempt++;
      if (this.retryAttempt <= simulateTransportFailureAttempts) {
        continue;
      }
      const verify = this.store.getRoomState(this.roomCode, this.playerToken, now);
      if (!verify.ok) {
        if (verify.code === 'INVALID_ROOM' || verify.code === 'EXPIRED_ROOM') {
          this.setStatus('Match Unavailable');
          return verify;
        }
        this.setStatus('Connection Failed');
        return verify;
      }
      const rejoin = this.store.joinRoom({
        roomCode: this.roomCode,
        nickname: '',
        playerToken: this.playerToken,
        now
      });
      if (rejoin.ok && rejoin.room) {
        this.roomSnapshot = rejoin.room;
        for (const ev of rejoin.room.events) {
          this.eventManager.emit({
            ...ev,
            suppressEffects: true
          });
        }
        this.bindRoomSubscription(this.roomCode);
        this.setStatus('Connection Restored');
        this.evaluateOpponentPresence(rejoin.room);
        return rejoin;
      }
    }
    this.setStatus('Connection Failed');
    return {
      ok: false,
      error: 'Maximum reconnection retries exceeded.'
    };
  }
  requestRematch(now) {
    if (!this.roomCode || !this.playerToken) {
      return {
        ok: false,
        code: 'UNAUTHORIZED',
        error: 'Not in a room.'
      };
    }
    return this.store.requestOrRespondRematch({
      roomCode: this.roomCode,
      playerToken: this.playerToken,
      action: 'request',
      now
    });
  }
  respondRematch(accept, now) {
    if (!this.roomCode || !this.playerToken) {
      return {
        ok: false,
        code: 'UNAUTHORIZED',
        error: 'Not in a room.'
      };
    }
    return this.store.requestOrRespondRematch({
      roomCode: this.roomCode,
      playerToken: this.playerToken,
      action: accept ? 'accept' : 'decline',
      now
    });
  }
  leaveRoom(now) {
    if (this.roomCode && this.playerToken) {
      this.store.setPlayerConnection({
        roomCode: this.roomCode,
        playerToken: this.playerToken,
        connected: false,
        now
      });
    }
    this.cleanupSubscription();
    this.roomCode = null;
    this.playerToken = null;
    this.roomSnapshot = null;
  }
  bindRoomSubscription(roomCode) {
    this.cleanupSubscription();
    this.unsubscribeStore = this.store.subscribeRoom(roomCode, (updatedRoom, latestEvents) => {
      this.roomSnapshot = updatedRoom;
      for (const ev of latestEvents) {
        this.eventManager.emit({
          eventId: ev.eventId,
          type: ev.type,
          timestamp: ev.timestamp,
          payload: ev.payload,
          suppressEffects: false
        });
      }
      this.evaluateOpponentPresence(updatedRoom);
    });
  }
  evaluateOpponentPresence(room) {
    if (!this.assignedColor) return;
    const oppColor = (0, _GameEngine.getOpponentColor)(this.assignedColor);
    const opp = room.players[oppColor];
    if (opp && !opp.connected) {
      this.setStatus('Opponent Disconnected');
    } else if (opp && opp.connected && this.connectionStatus === 'Opponent Disconnected') {
      this.setStatus('Connected');
    }
  }
  cleanupSubscription() {
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }
  }
}
exports.MultiplayerClientSession = MultiplayerClientSession;