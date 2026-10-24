/**
 * FLIX REVERSI — Centralized Typed Event System & Deduplicator
 * Separates authoritative game events from UI animations and sound playback.
 */

export const EVENT_TYPES = Object.freeze({
  GAME_INITIALIZED: 'GAME_INITIALIZED',
  MOVE_APPLIED: 'MOVE_APPLIED',
  DISCS_FLIPPED: 'DISCS_FLIPPED',
  ILLEGAL_MOVE_REJECTED: 'ILLEGAL_MOVE_REJECTED',
  TURN_CHANGED: 'TURN_CHANGED',
  TURN_SKIPPED: 'TURN_SKIPPED',
  MATCH_COMPLETED: 'MATCH_COMPLETED',
  ROOM_CREATED: 'ROOM_CREATED',
  PLAYER_JOINED: 'PLAYER_JOINED',
  PLAYER_DISCONNECTED: 'PLAYER_DISCONNECTED',
  CONNECTION_STATE_CHANGED: 'CONNECTION_STATE_CHANGED',
  REMATCH_REQUESTED: 'REMATCH_REQUESTED',
  REMATCH_RESPONDED: 'REMATCH_RESPONDED',
  TIMER_WARNING: 'TIMER_WARNING',
});

export class EventManager {
  constructor(maxHistory = 500) {
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
    /** @type {Set<string>} */
    this.processedEventIds = new Set();
    /** @type {Array<string>} */
    this.eventIdQueue = [];
    this.maxHistory = maxHistory;
    /** @type {Array<Object>} */
    this.eventLog = [];
  }

  /**
   * Subscribe to a specific event type or '*' for all events.
   * @param {string} type
   * @param {Function} handler
   * @returns {Function} unsubscribe function
   */
  on(type, handler) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(handler);
    return () => this.off(type, handler);
  }

  /**
   * Unsubscribe handler from event type.
   * @param {string} type
   * @param {Function} handler
   */
  off(type, handler) {
    const set = this.listeners.get(type);
    if (set) {
      set.delete(handler);
      if (set.size === 0) this.listeners.delete(type);
    }
  }

  /**
   * Emit a typed event with optional stable eventId for network deduplication.
   * @param {string} type
   * @param {Object} payload
   * @param {Object} [options]
   * @param {string} [options.eventId]
   * @param {boolean} [options.suppressEffects] - true during state restoration/reconnection so historical sounds/toasts don't replay
   * @returns {boolean} true if emitted, false if deduplicated
   */
  emit(type, payload = {}, options = {}) {
    const eventId = options.eventId || payload.eventId || null;
    if (eventId) {
      if (this.processedEventIds.has(eventId)) {
        return false; // Deduplicated!
      }
      this.processedEventIds.add(eventId);
      this.eventIdQueue.push(eventId);
      if (this.eventIdQueue.length > this.maxHistory) {
        const oldest = this.eventIdQueue.shift();
        this.processedEventIds.delete(oldest);
      }
    }

    const eventEnvelope = {
      id: eventId || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      payload,
      timestamp: Date.now(),
      suppressEffects: Boolean(options.suppressEffects),
    };

    this.eventLog.push(eventEnvelope);
    if (this.eventLog.length > this.maxHistory) {
      this.eventLog.shift();
    }

    const typeListeners = this.listeners.get(type);
    if (typeListeners) {
      for (const fn of [...typeListeners]) {
        try {
          fn(eventEnvelope);
        } catch (err) {
          console.error(`[EventManager] Handler error on ${type}:`, err);
        }
      }
    }

    const wildcardListeners = this.listeners.get('*');
    if (wildcardListeners) {
      for (const fn of [...wildcardListeners]) {
        try {
          fn(eventEnvelope);
        } catch (err) {
          console.error(`[EventManager] Wildcard handler error on ${type}:`, err);
        }
      }
    }

    return true;
  }

  /**
   * Mark a batch of historical event IDs as already seen (e.g., on reconnection)
   * so they will never trigger duplicate alerts or sounds.
   * @param {Array<string>} eventIds
   */
  markSeen(eventIds = []) {
    for (const id of eventIds) {
      if (!id || this.processedEventIds.has(id)) continue;
      this.processedEventIds.add(id);
      this.eventIdQueue.push(id);
      if (this.eventIdQueue.length > this.maxHistory) {
        const oldest = this.eventIdQueue.shift();
        this.processedEventIds.delete(oldest);
      }
    }
  }

  clear() {
    this.listeners.clear();
    this.processedEventIds.clear();
    this.eventIdQueue = [];
    this.eventLog = [];
  }
}
