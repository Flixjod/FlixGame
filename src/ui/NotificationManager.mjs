/**
 * FLIX REVERSI — Notification & Skipped-Turn Alert Manager
 * Driven by authoritative game and network events with event-ID deduplication.
 */

export class NotificationManager {
  constructor() {
    /** @type {Set<string>} */
    this.seenEventIds = new Set();
    /** @type {Array<Object>} */
    this.activeNotifications = [];
    /** @type {Array<Object>} */
    this.history = [];
    /** @type {Set<Function>} */
    this.subscribers = new Set();
  }

  subscribe(fn) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  notifySubscribers() {
    for (const fn of this.subscribers) {
      fn([...this.activeNotifications]);
    }
  }

  /**
   * Pushes a structured notification if its eventId hasn't been displayed yet.
   * @param {Object} notification
   * @param {string} [notification.eventId]
   * @param {'pass'|'connection'|'rematch'|'error'|'info'} notification.category
   * @param {string} notification.title
   * @param {string} notification.message
   * @param {number} [notification.durationMs]
   * @param {boolean} [notification.suppressEffects]
   * @returns {Object|null}
   */
  push(notification) {
    if (notification.suppressEffects) return null;

    if (notification.eventId) {
      if (this.seenEventIds.has(notification.eventId)) {
        return null; // Deduplicated!
      }
      this.seenEventIds.add(notification.eventId);
    }

    const item = {
      id: notification.eventId || `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      category: notification.category || 'info',
      title: notification.title,
      message: notification.message,
      createdAt: Date.now(),
      durationMs: notification.durationMs ?? 3800,
    };

    this.activeNotifications.push(item);
    this.history.push(item);
    this.notifySubscribers();
    return item;
  }

  /**
   * Formats and pushes an official skipped-turn alert per Section 10:
   * NO LEGAL MOVES — "Black has no available moves. White's turn."
   * @param {Object} params
   * @param {'B'|'W'} params.skippedPlayer
   * @param {'B'|'W'} params.nextTurn
   * @param {string} [params.eventId]
   * @param {boolean} [params.suppressEffects]
   */
  pushSkippedTurnAlert({ skippedPlayer, nextTurn, eventId, suppressEffects = false }) {
    const skippedLabel = skippedPlayer === 'B' ? 'Black' : 'White';
    const nextLabel = nextTurn === 'B' ? 'Black' : 'White';
    return this.push({
      eventId,
      suppressEffects,
      category: 'pass',
      title: 'NO LEGAL MOVES',
      message: `${skippedLabel} has no available moves. ${nextLabel}’s turn.`,
      durationMs: 4200,
    });
  }

  dismiss(id) {
    this.activeNotifications = this.activeNotifications.filter((n) => n.id !== id);
    this.notifySubscribers();
  }

  markSeen(eventIds = []) {
    for (const id of eventIds) {
      if (id) this.seenEventIds.add(id);
    }
  }

  clear() {
    this.activeNotifications = [];
    this.notifySubscribers();
  }
}
