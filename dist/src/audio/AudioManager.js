"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AudioManager = void 0;
/**
 * FLIX REVERSI — Centralized Audio Manager
 */

const DEFAULT_AUDIO_PREFS = {
  masterMute: false,
  sfxVolume: 0.75,
  musicVolume: 0.3,
  musicEnabled: false
};
const STORAGE_KEY = 'flix_reversi_audio_prefs_v1';
class AudioManager {
  ctx = null;
  unlocked = false;
  playedEventIds = new Set();
  lastSoundTimestamps = new Map();
  playHistoryLog = [];
  constructor(initialPrefs) {
    this.prefs = {
      ...DEFAULT_AUDIO_PREFS,
      ...this.loadPreferences(),
      ...initialPrefs
    };
  }
  loadPreferences() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          return {
            masterMute: Boolean(parsed.masterMute),
            sfxVolume: typeof parsed.sfxVolume === 'number' ? Math.max(0, Math.min(1, parsed.sfxVolume)) : 0.75,
            musicVolume: typeof parsed.musicVolume === 'number' ? Math.max(0, Math.min(1, parsed.musicVolume)) : 0.3,
            musicEnabled: Boolean(parsed.musicEnabled)
          };
        }
      }
    } catch {}
    return {};
  }
  savePreferences() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.prefs));
      }
    } catch {}
  }
  getPreferences() {
    return {
      ...this.prefs
    };
  }
  updatePreferences(patch) {
    if (patch.masterMute !== undefined) this.prefs.masterMute = Boolean(patch.masterMute);
    if (patch.sfxVolume !== undefined) {
      this.prefs.sfxVolume = Math.max(0, Math.min(1, Number(patch.sfxVolume)));
    }
    if (patch.musicVolume !== undefined) {
      this.prefs.musicVolume = Math.max(0, Math.min(1, Number(patch.musicVolume)));
    }
    if (patch.musicEnabled !== undefined) {
      this.prefs.musicEnabled = Boolean(patch.musicEnabled);
    }
    this.savePreferences();
    return this.getPreferences();
  }
  resetPreferences() {
    this.prefs = {
      ...DEFAULT_AUDIO_PREFS
    };
    this.savePreferences();
    return this.getPreferences();
  }
  unlockOnUserGesture() {
    this.unlocked = true;
    try {
      if (typeof window !== 'undefined') {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx && !this.ctx) {
          this.ctx = new AudioCtx();
        }
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }
      }
    } catch {}
    return this.unlocked;
  }
  isUnlocked() {
    return this.unlocked;
  }
  play(sound, options = {}) {
    if (options.eventId) {
      if (this.playedEventIds.has(options.eventId)) {
        return false;
      }
      this.playedEventIds.add(options.eventId);
    }
    if (this.prefs.masterMute || this.prefs.sfxVolume <= 0) {
      return false;
    }
    if (!this.unlocked) {
      return false;
    }
    const now = Date.now();
    const lastTime = this.lastSoundTimestamps.get(sound) ?? 0;
    if (now - lastTime < 35 && sound !== 'disc_flip') {
      return false;
    }
    this.lastSoundTimestamps.set(sound, now);
    this.playHistoryLog.push({
      sound,
      timestamp: now,
      eventId: options.eventId
    });
    return true;
  }
  testSound() {
    this.unlockOnUserGesture();
    return this.play('confirm');
  }
  getPlayHistory() {
    return this.playHistoryLog;
  }
}
exports.AudioManager = AudioManager;