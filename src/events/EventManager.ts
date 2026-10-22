/**
 * FLIX REVERSI — Centralized Typed Event System & Notification Manager
 */

export type FlixEventType =
  | 'MOVE_ACCEPTED'
  | 'DISCS_FLIPPED'
  | 'TURN_CHANGED'
  | 'TURN_SKIPPED'
  | 'ILLEGAL_MOVE'
  | 'GAME_COMPLETED'
  | 'ROOM_CREATED'
  | 'PLAYER_JOINED'
  | 'CONNECTION_STATE_CHANGED'
  | 'REMATCH_REQUESTED'
  | 'REMATCH_RESPONDED'
  | 'TIMER_WARNING'
  | 'UI_NOTIFICATION';

export interface FlixEvent<T = Record<string, unknown>> {
  eventId: string;
  type: FlixEventType;
  timestamp: number;
  payload: T;
  suppressEffects?: boolean;
}

export type EventListener<T = Record<string, unknown>> = (event: FlixEvent<T>) => void;

export class EventManager {
  private listeners: Map<FlixEventType | '*', Set<EventListener<any>>> = new Map();
  private processedIds: Set<string> = new Set();
  private idQueue: string[] = [];
  private readonly maxHistory: number;

  constructor(maxHistory = 1000) {
    this.maxHistory = maxHistory;
  }

  public on<T = Record<string, unknown>>(
    type: FlixEventType | '*',
    listener: EventListener<T>
  ): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
    return () => this.off(type, listener);
  }

  public off<T = Record<string, unknown>>(
    type: FlixEventType | '*',
    listener: EventListener<T>
  ): void {
    const set = this.listeners.get(type);
    if (set) {
      set.delete(listener);
    }
  }

  public emit<T = Record<string, unknown>>(event: FlixEvent<T>): boolean {
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

  public hasProcessed(eventId: string): boolean {
    return this.processedIds.has(eventId);
  }

  public clearDeduplicationCache(): void {
    this.processedIds.clear();
    this.idQueue = [];
  }
}

export interface NotificationItem {
  id: string;
  category: 'skipped_turn' | 'connection' | 'info' | 'warning' | 'error' | 'rematch';
  title: string;
  message: string;
  timestamp: number;
  durationMs: number;
}

export class NotificationManager {
  private activeNotifications: NotificationItem[] = [];
  private subscribers: Set<(items: NotificationItem[]) => void> = new Set();
  private seenIds: Set<string> = new Set();

  public subscribe(fn: (items: NotificationItem[]) => void): () => void {
    this.subscribers.add(fn);
    fn([...this.activeNotifications]);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  public notify(item: Omit<NotificationItem, 'timestamp'> & { timestamp?: number }): boolean {
    if (this.seenIds.has(item.id)) {
      return false;
    }
    this.seenIds.add(item.id);
    const fullItem: NotificationItem = {
      ...item,
      timestamp: item.timestamp ?? Date.now(),
    };
    this.activeNotifications = [
      fullItem,
      ...this.activeNotifications.filter((n) => n.id !== fullItem.id),
    ].slice(0, 5);
    this.broadcast();
    return true;
  }

  public dismiss(id: string): void {
    const before = this.activeNotifications.length;
    this.activeNotifications = this.activeNotifications.filter((n) => n.id !== id);
    if (this.activeNotifications.length !== before) {
      this.broadcast();
    }
  }

  public clearAll(): void {
    this.activeNotifications = [];
    this.broadcast();
  }

  public getActive(): NotificationItem[] {
    return [...this.activeNotifications];
  }

  private broadcast(): void {
    const snapshot = [...this.activeNotifications];
    for (const sub of this.subscribers) {
      sub(snapshot);
    }
  }
}
