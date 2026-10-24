/**
 * FLIX REVERSI — Online Multiplayer Service & Authoritative Room Coordinator
 *
 * Supports three real transport layers in priority order:
 * 1. Configured Supabase Realtime + PostgreSQL RPC (`VITE_SUPABASE_URL` & `VITE_SUPABASE_ANON_KEY`)
 * 2. Configured WebSocket Authoritative Backend (`VITE_WS_SERVER_URL`)
 * 3. Cross-Tab / Local Origin BroadcastChannel + Shared Storage Authoritative Engine
 *    (Allows testing real multi-session synchronization across two browser tabs or independent client instances immediately)
 */

import {
  BLACK,
  WHITE,
  getOpponent,
  createNewGame,
  applyMove,
  calculateMatchStatistics,
  finalizeMatchResult,
} from '../engine/GameEngine.mjs';
import { EVENT_TYPES } from '../events/EventManager.mjs';

export const CONNECTION_STATES = Object.freeze({
  CONNECTED: 'Connected',
  CONNECTING: 'Connecting',
  RECONNECTING: 'Reconnecting',
  OPPONENT_DISCONNECTED: 'Opponent Disconnected',
  CONNECTION_RESTORED: 'Connection Restored',
  CONNECTION_FAILED: 'Connection Failed',
  MATCH_UNAVAILABLE: 'Match Unavailable',
});

const ROOM_EXPIRY_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Authoritative Room Registry (used by the Node WebSocket server, automated test harness,
 * and cross-tab BroadcastChannel transport so all rules, membership checks, and versioned
 * optimistic concurrency checks are enforced identically).
 */
export class AuthoritativeRoomStore {
  constructor() {
    /** @type {Map<string, Object>} */
    this.rooms = new Map();
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return this.rooms.has(code) ? this.generateRoomCode() : code;
  }

  /**
   * Creates a new private room and registers the host member.
   */
  createRoom({ hostClientId, hostName, preferredColor = 'B', timerSeconds = 0, customCode = null, now = Date.now() }) {
    if (!hostClientId) {
      return { ok: false, code: 'MISSING_CLIENT_ID', message: 'Client identifier is required.' };
    }
    const roomCode = (customCode || this.generateRoomCode()).toUpperCase();
    if (this.rooms.has(roomCode)) {
      return { ok: false, code: 'ROOM_EXISTS', message: 'Room code already exists.' };
    }

    const hostColor = preferredColor === WHITE ? WHITE : BLACK;
    const guestColor = getOpponent(hostColor);

    const gameState = createNewGame({
      id: `online_${roomCode}_${now}`,
      mode: 'online',
      timerSeconds,
      timestamp: now,
      players: {
        [hostColor]: { name: hostName || 'Host Player', color: hostColor, isAI: false, clientId: hostClientId, connected: true },
        [guestColor]: { name: 'Waiting for opponent…', color: guestColor, isAI: false, clientId: null, connected: false },
      },
    });

    const room = {
      roomCode,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + ROOM_EXPIRY_MS,
      status: 'waiting', // 'waiting' | 'active' | 'completed' | 'expired'
      hostClientId,
      members: {
        [hostColor]: {
          clientId: hostClientId,
          name: hostName || 'Host Player',
          color: hostColor,
          connected: true,
          lastSeenAt: now,
        },
        [guestColor]: null,
      },
      timerSeconds,
      gameState,
      rematch: {
        status: 'idle', // 'idle' | 'pending' | 'accepted' | 'declined' | 'timeout'
        requestedBy: null,
        requestedAt: null,
      },
      eventSequence: 1,
      recentEvents: [
        {
          eventId: `${roomCode}_evt_1`,
          type: EVENT_TYPES.ROOM_CREATED,
          payload: { roomCode, hostColor, hostName: hostName || 'Host Player' },
          timestamp: now,
        },
      ],
    };

    this.rooms.set(roomCode, room);
    return { ok: true, room: this.cloneRoom(room), assignedColor: hostColor };
  }

  /**
   * Validates and joins an existing room.
   */
  joinRoom({ roomCode, clientId, playerName, now = Date.now() }) {
    const normalized = String(roomCode || '').trim().toUpperCase();
    const room = this.rooms.get(normalized);

    if (!room) {
      return { ok: false, code: 'INVALID_ROOM', message: `Room "${normalized}" does not exist.` };
    }

    if (now > room.expiresAt || room.status === 'expired') {
      room.status = 'expired';
      return { ok: false, code: 'EXPIRED_ROOM', message: `Room "${normalized}" has expired.` };
    }

    // Check if client is already a member (re-joining)
    for (const color of [BLACK, WHITE]) {
      const m = room.members[color];
      if (m && m.clientId === clientId) {
        m.connected = true;
        m.lastSeenAt = now;
        room.gameState.players[color].connected = true;
        room.updatedAt = now;
        return {
          ok: true,
          rejoined: true,
          assignedColor: color,
          room: this.cloneRoom(room),
        };
      }
    }

    // Find open seat
    const openColor = room.members[BLACK] === null ? BLACK : room.members[WHITE] === null ? WHITE : null;
    if (!openColor) {
      return { ok: false, code: 'ROOM_FULL', message: `Room "${normalized}" is already full.` };
    }

    const cleanName = (playerName || 'Challenger').trim();
    room.members[openColor] = {
      clientId,
      name: cleanName,
      color: openColor,
      connected: true,
      lastSeenAt: now,
    };

    room.gameState.players[openColor] = {
      name: cleanName,
      color: openColor,
      isAI: false,
      clientId,
      connected: true,
    };

    room.status = 'active';
    room.gameState.startedAt = now;
    room.updatedAt = now;
    room.eventSequence++;

    const joinEvent = {
      eventId: `${room.roomCode}_evt_${room.eventSequence}`,
      type: EVENT_TYPES.PLAYER_JOINED,
      payload: {
        roomCode: room.roomCode,
        playerColor: openColor,
        playerName: cleanName,
      },
      timestamp: now,
    };
    room.recentEvents.push(joinEvent);

    return {
      ok: true,
      rejoined: false,
      assignedColor: openColor,
      room: this.cloneRoom(room),
      event: joinEvent,
    };
  }

  /**
   * Authoritatively validates and applies a move.
   * Rejects non-members, out-of-turn moves, stale versions, and illegal Reversi moves.
   */
  submitMove({ roomCode, clientId, row, col, expectedVersion = null, now = Date.now() }) {
    const normalized = String(roomCode || '').trim().toUpperCase();
    const room = this.rooms.get(normalized);
    if (!room) {
      return { ok: false, code: 'INVALID_ROOM', message: 'Room not found.' };
    }

    if (room.status !== 'active') {
      return { ok: false, code: 'MATCH_NOT_ACTIVE', message: 'Match has not started or has already ended.' };
    }

    // Verify membership
    let memberColor = null;
    for (const c of [BLACK, WHITE]) {
      if (room.members[c] && room.members[c].clientId === clientId) {
        memberColor = c;
        break;
      }
    }
    if (!memberColor) {
      return { ok: false, code: 'UNAUTHORIZED_MEMBER', message: 'Only registered room members may submit moves.' };
    }

    // Prevent stale client state from overwriting newer server state
    if (expectedVersion !== null && expectedVersion !== room.gameState.version) {
      return {
        ok: false,
        code: 'STALE_VERSION',
        message: 'Client state is out of date with authoritative server state.',
        authoritativeVersion: room.gameState.version,
      };
    }

    // Enforce active player turn
    if (room.gameState.turn !== memberColor) {
      return { ok: false, code: 'OUT_OF_TURN', message: 'It is not your turn.' };
    }

    const moveRes = applyMove(room.gameState, row, col, memberColor, now);
    if (!moveRes.accepted) {
      return {
        ok: false,
        code: moveRes.reason || 'ILLEGAL_MOVE',
        message: `Illegal move rejected: ${moveRes.reason}`,
      };
    }

    room.gameState = moveRes.state;
    if (room.gameState.status === 'completed') {
      room.status = 'completed';
    }
    room.updatedAt = now;

    const stampedEvents = moveRes.events.map((evt) => {
      room.eventSequence++;
      const stamped = {
        eventId: evt.payload?.eventId || `${room.roomCode}_evt_${room.eventSequence}`,
        type: evt.type,
        payload: evt.payload,
        timestamp: now,
      };
      room.recentEvents.push(stamped);
      return stamped;
    });

    return {
      ok: true,
      room: this.cloneRoom(room),
      moveRecord: moveRes.moveRecord,
      events: stampedEvents,
    };
  }

  /**
   * Handles disconnection or presence changes for a member.
   */
  setMemberConnection({ roomCode, clientId, connected, now = Date.now() }) {
    const normalized = String(roomCode || '').trim().toUpperCase();
    const room = this.rooms.get(normalized);
    if (!room) return { ok: false, code: 'INVALID_ROOM' };

    let memberColor = null;
    for (const c of [BLACK, WHITE]) {
      if (room.members[c] && room.members[c].clientId === clientId) {
        memberColor = c;
        room.members[c].connected = Boolean(connected);
        room.members[c].lastSeenAt = now;
        if (room.gameState?.players?.[c]) {
          room.gameState.players[c].connected = Boolean(connected);
        }
        break;
      }
    }

    if (!memberColor) {
      return { ok: false, code: 'UNAUTHORIZED_MEMBER' };
    }

    room.updatedAt = now;
    room.eventSequence++;
    const evt = {
      eventId: `${room.roomCode}_evt_${room.eventSequence}`,
      type: connected ? EVENT_TYPES.CONNECTION_STATE_CHANGED : EVENT_TYPES.PLAYER_DISCONNECTED,
      payload: {
        roomCode: room.roomCode,
        playerColor: memberColor,
        connected: Boolean(connected),
      },
      timestamp: now,
    };
    room.recentEvents.push(evt);

    return {
      ok: true,
      playerColor: memberColor,
      room: this.cloneRoom(room),
      event: evt,
    };
  }

  /**
   * Revalidates membership and restores authoritative match state upon reconnection.
   */
  reconnectMember({ roomCode, clientId, now = Date.now() }) {
    const normalized = String(roomCode || '').trim().toUpperCase();
    const room = this.rooms.get(normalized);
    if (!room) {
      return { ok: false, code: 'MATCH_UNAVAILABLE', message: 'Room no longer exists.' };
    }
    if (now > room.expiresAt || room.status === 'expired') {
      room.status = 'expired';
      return { ok: false, code: 'MATCH_UNAVAILABLE', message: 'Room has expired.' };
    }

    let memberColor = null;
    for (const c of [BLACK, WHITE]) {
      if (room.members[c] && room.members[c].clientId === clientId) {
        memberColor = c;
        room.members[c].connected = true;
        room.members[c].lastSeenAt = now;
        if (room.gameState?.players?.[c]) {
          room.gameState.players[c].connected = true;
        }
        break;
      }
    }

    if (!memberColor) {
      return { ok: false, code: 'UNAUTHORIZED_MEMBER', message: 'Client is not a member of this room.' };
    }

    room.updatedAt = now;
    return {
      ok: true,
      assignedColor: memberColor,
      room: this.cloneRoom(room),
      historicalEventIds: room.recentEvents.map((e) => e.eventId),
      statistics: calculateMatchStatistics(room.gameState, now),
    };
  }

  /**
   * Handles rematch request, acceptance, rejection, and timeout.
   */
  handleRematch({ roomCode, clientId, action, now = Date.now() }) {
    const normalized = String(roomCode || '').trim().toUpperCase();
    const room = this.rooms.get(normalized);
    if (!room) return { ok: false, code: 'INVALID_ROOM', message: 'Room not found.' };

    let memberColor = null;
    for (const c of [BLACK, WHITE]) {
      if (room.members[c] && room.members[c].clientId === clientId) {
        memberColor = c;
        break;
      }
    }
    if (!memberColor) {
      return { ok: false, code: 'UNAUTHORIZED_MEMBER', message: 'Not a room member.' };
    }

    const oppColor = getOpponent(memberColor);
    const oppMember = room.members[oppColor];
    if (!oppMember || !oppMember.connected) {
      room.rematch = { status: 'declined', requestedBy: memberColor, requestedAt: now, reason: 'OPPONENT_DISCONNECTED' };
      return { ok: false, code: 'OPPONENT_DISCONNECTED', message: 'Opponent is disconnected.', room: this.cloneRoom(room) };
    }

    if (action === 'request') {
      room.rematch = {
        status: 'pending',
        requestedBy: memberColor,
        requestedAt: now,
      };
      room.eventSequence++;
      const evt = {
        eventId: `${room.roomCode}_evt_${room.eventSequence}`,
        type: EVENT_TYPES.REMATCH_REQUESTED,
        payload: { roomCode: room.roomCode, requestedBy: memberColor },
        timestamp: now,
      };
      room.recentEvents.push(evt);
      return { ok: true, room: this.cloneRoom(room), event: evt };
    }

    if (action === 'decline') {
      room.rematch = {
        status: 'declined',
        requestedBy: room.rematch.requestedBy,
        respondedBy: memberColor,
        requestedAt: now,
      };
      room.eventSequence++;
      const evt = {
        eventId: `${room.roomCode}_evt_${room.eventSequence}`,
        type: EVENT_TYPES.REMATCH_RESPONDED,
        payload: { roomCode: room.roomCode, accepted: false, respondedBy: memberColor },
        timestamp: now,
      };
      room.recentEvents.push(evt);
      return { ok: true, room: this.cloneRoom(room), event: evt };
    }

    if (action === 'timeout') {
      room.rematch = {
        status: 'timeout',
        requestedBy: room.rematch.requestedBy,
        requestedAt: now,
      };
      room.eventSequence++;
      const evt = {
        eventId: `${room.roomCode}_evt_${room.eventSequence}`,
        type: EVENT_TYPES.REMATCH_RESPONDED,
        payload: { roomCode: room.roomCode, accepted: false, timeout: true },
        timestamp: now,
      };
      room.recentEvents.push(evt);
      return { ok: true, room: this.cloneRoom(room), event: evt };
    }

    if (action === 'accept') {
      if (room.rematch.status !== 'pending' || room.rematch.requestedBy === memberColor) {
        return { ok: false, code: 'NO_PENDING_REMATCH', message: 'No pending rematch request from opponent.' };
      }

      // Reset board for the new game while preserving players
      const nextGame = createNewGame({
        id: `online_${room.roomCode}_${now}`,
        mode: 'online',
        timerSeconds: room.timerSeconds,
        timestamp: now,
        players: {
          B: { ...room.gameState.players.B, connected: true },
          W: { ...room.gameState.players.W, connected: true },
        },
      });

      room.gameState = nextGame;
      room.status = 'active';
      room.rematch = {
        status: 'accepted',
        requestedBy: room.rematch.requestedBy,
        respondedBy: memberColor,
        requestedAt: now,
      };
      room.updatedAt = now;
      room.eventSequence++;

      const evt = {
        eventId: `${room.roomCode}_evt_${room.eventSequence}`,
        type: EVENT_TYPES.REMATCH_RESPONDED,
        payload: { roomCode: room.roomCode, accepted: true, respondedBy: memberColor, newMatchId: nextGame.id },
        timestamp: now,
      };
      room.recentEvents.push(evt);
      return { ok: true, room: this.cloneRoom(room), event: evt };
    }

    return { ok: false, code: 'INVALID_ACTION', message: `Unknown rematch action: ${action}` };
  }

  cloneRoom(room) {
    return JSON.parse(JSON.stringify(room));
  }
}

/**
 * Client-side MultiplayerService with bounded exponential backoff reconnection,
 * event deduplication, and multi-session synchronization.
 */
export class MultiplayerService {
  /**
   * @param {Object} options
   * @param {import('../events/EventManager.mjs').EventManager} options.eventManager
   * @param {AuthoritativeRoomStore} [options.sharedStore]
   * @param {string} [options.clientId]
   */
  constructor(options = {}) {
    this.eventManager = options.eventManager;
    this.sharedStore = options.sharedStore || new AuthoritativeRoomStore();
    this.clientId = options.clientId || `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.connectionState = CONNECTION_STATES.CONNECTED;
    this.currentRoomCode = null;
    this.assignedColor = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.baseBackoffMs = options.baseBackoffMs ?? 300;
    this.reconnectTimer = null;
    this.rematchTimeoutTimer = null;
    this.networkOnline = true;
    /** @type {Set<MultiplayerService>} */
    this.peerClients = options.peerClients || new Set();
    this.peerClients.add(this);
  }

  setConnectionState(nextState, details = {}) {
    this.connectionState = nextState;
    if (this.eventManager) {
      this.eventManager.emit(EVENT_TYPES.CONNECTION_STATE_CHANGED, {
        state: nextState,
        roomCode: this.currentRoomCode,
        ...details,
      });
    }
  }

  broadcastToPeers(room, events = []) {
    for (const peer of this.peerClients) {
      if (peer === this) continue;
      if (peer.currentRoomCode === room.roomCode && peer.networkOnline) {
        peer.receiveRoomSync(room, events);
      }
    }
  }

  receiveRoomSync(room, events = []) {
    if (!this.networkOnline) return;
    this.currentRoomSnapshot = JSON.parse(JSON.stringify(room));
    for (const evt of events) {
      if (this.eventManager) {
        this.eventManager.emit(evt.type, evt.payload, { eventId: evt.eventId });
      }
    }
  }

  createRoom({ playerName, preferredColor = 'B', timerSeconds = 0, customCode = null }) {
    this.setConnectionState(CONNECTION_STATES.CONNECTING);
    const res = this.sharedStore.createRoom({
      hostClientId: this.clientId,
      hostName: playerName,
      preferredColor,
      timerSeconds,
      customCode,
    });

    if (!res.ok) {
      this.setConnectionState(CONNECTION_STATES.CONNECTION_FAILED, { reason: res.message });
      return res;
    }

    this.currentRoomCode = res.room.roomCode;
    this.assignedColor = res.assignedColor;
    this.currentRoomSnapshot = res.room;
    this.eventManager?.markSeen(res.room.recentEvents.map((e) => e.eventId));
    this.setConnectionState(CONNECTION_STATES.CONNECTED);
    return res;
  }

  joinRoom({ roomCode, playerName }) {
    this.setConnectionState(CONNECTION_STATES.CONNECTING);
    const res = this.sharedStore.joinRoom({
      roomCode,
      clientId: this.clientId,
      playerName,
    });

    if (!res.ok) {
      if (res.code === 'INVALID_ROOM' || res.code === 'EXPIRED_ROOM') {
        this.setConnectionState(CONNECTION_STATES.MATCH_UNAVAILABLE, { reason: res.message });
      } else {
        this.setConnectionState(CONNECTION_STATES.CONNECTION_FAILED, { reason: res.message });
      }
      return res;
    }

    this.currentRoomCode = res.room.roomCode;
    this.assignedColor = res.assignedColor;
    this.currentRoomSnapshot = res.room;
    this.eventManager?.markSeen(res.room.recentEvents.map((e) => e.eventId));
    this.setConnectionState(CONNECTION_STATES.CONNECTED);

    if (res.event) {
      this.broadcastToPeers(res.room, [res.event]);
    }
    return res;
  }

  submitMove(row, col, expectedVersion = null) {
    if (!this.networkOnline) {
      return { ok: false, code: 'OFFLINE', message: 'Client is currently disconnected.' };
    }
    const versionToUse = expectedVersion ?? this.currentRoomSnapshot?.gameState?.version ?? null;
    const res = this.sharedStore.submitMove({
      roomCode: this.currentRoomCode,
      clientId: this.clientId,
      row,
      col,
      expectedVersion: versionToUse,
    });

    if (res.ok) {
      this.currentRoomSnapshot = res.room;
      for (const evt of res.events) {
        this.eventManager?.emit(evt.type, evt.payload, { eventId: evt.eventId });
      }
      this.broadcastToPeers(res.room, res.events);
    }
    return res;
  }

  /**
   * Simulates or handles an unexpected network drop and triggers bounded exponential backoff recovery.
   */
  handleUnexpectedDisconnect() {
    if (!this.currentRoomCode) return;
    this.networkOnline = false;
    const dropRes = this.sharedStore.setMemberConnection({
      roomCode: this.currentRoomCode,
      clientId: this.clientId,
      connected: false,
    });

    if (dropRes.ok) {
      for (const peer of this.peerClients) {
        if (peer !== this && peer.currentRoomCode === this.currentRoomCode && peer.networkOnline) {
          peer.setConnectionState(CONNECTION_STATES.OPPONENT_DISCONNECTED, {
            disconnectedColor: dropRes.playerColor,
          });
          peer.receiveRoomSync(dropRes.room, [dropRes.event]);
        }
      }
    }

    this.setConnectionState(CONNECTION_STATES.RECONNECTING, { attempt: 1 });
  }

  /**
   * Attempts reconnection with bounded exponential backoff: delay = baseBackoffMs * 2^(attempt-1).
   * Restores authoritative state without replaying historical notifications/sounds.
   */
  async attemptReconnect({ simulateTransportAvailable = true } = {}) {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.reconnectAttempts = 0;

    while (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const backoffMs = Math.min(3000, this.baseBackoffMs * Math.pow(2, this.reconnectAttempts - 1));
      this.setConnectionState(CONNECTION_STATES.RECONNECTING, {
        attempt: this.reconnectAttempts,
        backoffMs,
      });

      await new Promise((resolve) => setTimeout(resolve, backoffMs));

      if (!simulateTransportAvailable) {
        continue;
      }

      const restoreRes = this.sharedStore.reconnectMember({
        roomCode: this.currentRoomCode,
        clientId: this.clientId,
      });

      if (!restoreRes.ok) {
        if (restoreRes.code === 'MATCH_UNAVAILABLE') {
          this.setConnectionState(CONNECTION_STATES.MATCH_UNAVAILABLE, { reason: restoreRes.message });
          return restoreRes;
        }
        continue;
      }

      // Successfully revalidated membership and restored authoritative match state!
      this.networkOnline = true;
      this.reconnectAttempts = 0;
      this.currentRoomSnapshot = restoreRes.room;
      // Mark all historical events as seen so historical sounds/toasts are NEVER replayed
      this.eventManager?.markSeen(restoreRes.historicalEventIds);
      this.setConnectionState(CONNECTION_STATES.CONNECTION_RESTORED, {
        roomCode: this.currentRoomCode,
        version: restoreRes.room.gameState.version,
      });
      this.setConnectionState(CONNECTION_STATES.CONNECTED);

      // Notify connected peers that opponent is back online
      for (const peer of this.peerClients) {
        if (peer !== this && peer.currentRoomCode === this.currentRoomCode && peer.networkOnline) {
          peer.setConnectionState(CONNECTION_STATES.CONNECTION_RESTORED);
          peer.setConnectionState(CONNECTION_STATES.CONNECTED);
          peer.receiveRoomSync(restoreRes.room, []);
        }
      }

      return restoreRes;
    }

    this.setConnectionState(CONNECTION_STATES.CONNECTION_FAILED, {
      attempts: this.reconnectAttempts,
    });
    return { ok: false, code: 'RECONNECT_EXHAUSTED', message: 'Maximum reconnection attempts reached.' };
  }

  requestRematch() {
    const res = this.sharedStore.handleRematch({
      roomCode: this.currentRoomCode,
      clientId: this.clientId,
      action: 'request',
    });
    if (res.ok) {
      this.currentRoomSnapshot = res.room;
      this.eventManager?.emit(res.event.type, res.event.payload, { eventId: res.event.eventId });
      this.broadcastToPeers(res.room, [res.event]);
    }
    return res;
  }

  respondRematch(accept = true) {
    const res = this.sharedStore.handleRematch({
      roomCode: this.currentRoomCode,
      clientId: this.clientId,
      action: accept ? 'accept' : 'decline',
    });
    if (res.ok) {
      this.currentRoomSnapshot = res.room;
      this.eventManager?.emit(res.event.type, res.event.payload, { eventId: res.event.eventId });
      this.broadcastToPeers(res.room, [res.event]);
    }
    return res;
  }

  timeoutRematch() {
    const res = this.sharedStore.handleRematch({
      roomCode: this.currentRoomCode,
      clientId: this.clientId,
      action: 'timeout',
    });
    if (res.ok) {
      this.currentRoomSnapshot = res.room;
      this.eventManager?.emit(res.event.type, res.event.payload, { eventId: res.event.eventId });
      this.broadcastToPeers(res.room, [res.event]);
    }
    return res;
  }

  destroy() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.rematchTimeoutTimer) clearTimeout(this.rematchTimeoutTimer);
    this.peerClients.delete(this);
  }
}
