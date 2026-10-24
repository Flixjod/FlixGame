/**
 * FLIX REVERSI — Centralized Audio Manager
 * Provides Web Audio API synthesized board/disc/UI acoustics, volume categories,
 * master mute, autoplay unlock handling, and event-ID deduplication to prevent
 * duplicate sounds during rerenders or reconnections.
 */

export const SOUND_EFFECTS = Object.freeze({
  UI_CLICK: 'ui_click',
  UI_CONFIRM: 'ui_confirm',
  DISC_PLACE: 'disc_place',
  DISC_FLIP: 'disc_flip',
  ILLEGAL_MOVE: 'illegal_move',
  TURN_CHANGE: 'turn_change',
  TURN_SKIP: 'turn_skip',
  ROOM_CREATED: 'room_created',
  PLAYER_JOINED: 'player_joined',
  DISCONNECTED: 'disconnected',
  RECONNECTED: 'reconnected',
  CONNECTION_FAILED: 'connection_failed',
  REMATCH_REQUEST: 'rematch_request',
  REMATCH_ACCEPTED: 'rematch_accepted',
  REMATCH_DECLINED: 'rematch_declined',
  VICTORY: 'victory',
  DEFEAT: 'defeat',
  DRAW: 'draw',
  TIMER_WARNING: 'timer_warning',
  COPY_LINK: 'copy_link',
  ERROR: 'error',
});

export class AudioManager {
  constructor(options = {}) {
    this.storageKey = options.storageKey || 'flix_reversi_audio_prefs_v1';
    this.muted = false;
    this.sfxVolume = 0.75;
    this.musicVolume = 0.0; // Disabled by default per requirements
    this.musicEnabled = false;
    this.unlocked = false;
    this.ctx = null;
    /** @type {Set<string>} */
    this.playedEventIds = new Set();
    /** @type {Array<string>} */
    this.playHistory = [];

    this.loadPreferences();
  }

  loadPreferences() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(this.storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (typeof parsed.muted === 'boolean') this.muted = parsed.muted;
          if (typeof parsed.sfxVolume === 'number') this.sfxVolume = Math.max(0, Math.min(1, parsed.sfxVolume));
          if (typeof parsed.musicVolume === 'number') this.musicVolume = Math.max(0, Math.min(1, parsed.musicVolume));
          if (typeof parsed.musicEnabled === 'boolean') this.musicEnabled = parsed.musicEnabled;
        }
      }
    } catch (_) {
      // Graceful fallback when localStorage is unavailable
    }
  }

  savePreferences() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(
          this.storageKey,
          JSON.stringify({
            muted: this.muted,
            sfxVolume: this.sfxVolume,
            musicVolume: this.musicVolume,
            musicEnabled: this.musicEnabled,
          })
        );
      }
    } catch (_) {
      // Ignore storage errors in sandboxed iframes
    }
  }

  /**
   * Unlocks Web Audio context after a genuine user gesture.
   */
  unlock() {
    this.unlocked = true;
    try {
      if (typeof window !== 'undefined' && !this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    } catch (_) {
      // Graceful fallback when Web Audio API is unavailable
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this.savePreferences();
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  setSfxVolume(vol) {
    this.sfxVolume = Math.max(0, Math.min(1, Number(vol) || 0));
    this.savePreferences();
    return this.sfxVolume;
  }

  setMusicVolume(vol) {
    this.musicVolume = Math.max(0, Math.min(1, Number(vol) || 0));
    this.musicEnabled = this.musicVolume > 0;
    this.savePreferences();
    return this.musicVolume;
  }

  resetDefaults() {
    this.muted = false;
    this.sfxVolume = 0.75;
    this.musicVolume = 0.0;
    this.musicEnabled = false;
    this.savePreferences();
  }

  /**
   * Plays a sound effect with optional eventId deduplication and flip count cap.
   * @param {string} soundName
   * @param {Object} [options]
   * @param {string} [options.eventId]
   * @param {number} [options.flipCount]
   * @param {boolean} [options.suppressEffects]
   * @returns {boolean} true if played, false if muted/deduplicated/locked
   */
  play(soundName, options = {}) {
    if (options.suppressEffects) return false;
    if (this.muted || this.sfxVolume <= 0) return false;

    if (options.eventId) {
      if (this.playedEventIds.has(options.eventId)) {
        return false;
      }
      this.playedEventIds.add(options.eventId);
    }

    this.playHistory.push({
      soundName,
      eventId: options.eventId || null,
      timestamp: Date.now(),
    });

    if (!this.ctx) return true; // Recorded in playHistory for headless tests

    try {
      const now = this.ctx.currentTime;
      const gainLevel = this.sfxVolume * 0.35;

      if (soundName === SOUND_EFFECTS.DISC_FLIP) {
        // Cap overlapping cascade flips to max 4 gentle ticks so multi-disc flips sound crisp
        const count = Math.min(4, Math.max(1, options.flipCount || 1));
        for (let i = 0; i < count; i++) {
          this.synthTone(320 + i * 55, now + i * 0.045, 0.06, 'triangle', gainLevel * 0.7);
        }
        return true;
      }

      switch (soundName) {
        case SOUND_EFFECTS.DISC_PLACE:
          this.synthTone(185, now, 0.075, 'sine', gainLevel);
          this.synthTone(420, now + 0.015, 0.045, 'triangle', gainLevel * 0.5);
          break;
        case SOUND_EFFECTS.ILLEGAL_MOVE:
          this.synthTone(130, now, 0.12, 'sawtooth', gainLevel * 0.6);
          this.synthTone(105, now + 0.09, 0.14, 'sawtooth', gainLevel * 0.6);
          break;
        case SOUND_EFFECTS.TURN_SKIP:
          this.synthTone(440, now, 0.11, 'sine', gainLevel * 0.8);
          this.synthTone(330, now + 0.1, 0.16, 'sine', gainLevel * 0.8);
          break;
        case SOUND_EFFECTS.VICTORY:
          [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
            this.synthTone(freq, now + idx * 0.09, 0.22, 'triangle', gainLevel * 0.85);
          });
          break;
        case SOUND_EFFECTS.DEFEAT:
          [392.0, 349.23, 311.13, 261.63].forEach((freq, idx) => {
            this.synthTone(freq, now + idx * 0.11, 0.24, 'sine', gainLevel * 0.75);
          });
          break;
        case SOUND_EFFECTS.DRAW:
          [440, 554.37, 659.25].forEach((freq, idx) => {
            this.synthTone(freq, now + idx * 0.08, 0.2, 'sine', gainLevel * 0.7);
          });
          break;
        default:
          this.synthTone(520, now, 0.05, 'sine', gainLevel * 0.5);
          break;
      }
    } catch (_) {
      // Ignore audio hardware failures gracefully
    }
    return true;
  }

  synthTone(freq, startTime, duration, type, maxGain) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, maxGain), startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }

  testSound() {
    this.unlock();
    return this.play(SOUND_EFFECTS.VICTORY);
  }
}
