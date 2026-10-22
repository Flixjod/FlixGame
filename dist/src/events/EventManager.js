"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.NotificationManager = exports.EventManager = void 0;
/**
 * FLIX REVERSI — Centralized Typed Event System & Notification Manager
 */

class EventManager {
  listeners = new Map();
  processedIds = new Set();
  idQueue = [];
  constructor(maxHistory = 1000) {
    this.maxHistory = maxHistory;
  }
  on(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(listener);
    return () => this.off(type, listener);
  }
  off(type, listener) {
    const set = this.listeners.get(type);
    if (set) {
      set.delete(listener);
    }
  }
  emit(event) {
    if (!event.eventId) {
      throw new Error('Event must include a non-empty eventId for deduplication.');
    }
    if (this.processedIds.has(event.eventId)) {
      return false;
    }
    this.processedIds.add(event.eventId);
    this.idQueue.push(event.eventId);
    if (this.idQueue.length > this.maxHistory) {
      const oldest = this.idQueue.shift();
      if (oldest) this.processedIds.delete(oldest);
    }
    const typeListeners = this.listeners.get(event.type);
    if (typeListeners) {
      for (const fn of typeListeners) {
        fn(event);
      }
    }
    const wildcardListeners = this.listeners.get('*');
    if (wildcardListeners) {
      for (const fn of wildcardListeners) {
        fn(event);
      }
    }
    return true;
  }
  hasProcessed(eventId) {
    return this.processedIds.has(eventId);
  }
  clearDeduplicationCache() {
    this.processedIds.clear();
    this.idQueue = [];
  }
}
exports.EventManager = EventManager;
class NotificationManager {
  activeNotifications = [];
  subscribers = new Set();
  seenIds = new Set();
  subscribe(fn) {
    this.subscribers.add(fn);
    fn([...this.activeNotifications]);
    return () => {
      this.subscribers.delete(fn);
    };
  }
  notify(item) {
    if (this.seenIds.has(item.id)) {
      return false;
    }
    this.seenIds.add(item.id);
    const fullItem = {
      ...item,
      timestamp: item.timestamp ?? Date.now()
    };
    this.activeNotifications = [fullItem, ...this.activeNotifications.filter(n => n.id !== fullItem.id)].slice(0, 5);
    this.broadcast();
    return true;
  }
  dismiss(id) {
    const before = this.activeNotifications.length;
    this.activeNotifications = this.activeNotifications.filter(n => n.id !== id);
    if (this.activeNotifications.length !== before) {
      this.broadcast();
    }
  }
  clearAll() {
    this.activeNotifications = [];
    this.broadcast();
  }
  getActive() {
    return [...this.activeNotifications];
  }
  broadcast() {
    const snapshot = [...this.activeNotifications];
    for (const sub of this.subscribers) {
      sub(snapshot);
    }
  }
}
exports.NotificationManager = NotificationManager;