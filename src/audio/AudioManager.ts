/**
 * FLIX REVERSI — Centralized Audio Manager
 */

export type SoundEffectName =
  | 'ui_click'
  | 'confirm'
  | 'disc_place'
  | 'disc_flip'
  | 'illegal_move'
  | 'turn_change'
  | 'turn_skip'
  | 'room_create'
  | 'opponent_join'
  | 'disconnect'
  | 'reconnect_success'
  | 'reconnect_fail'
  | 'rematch_request'
  | 'rematch_accept'
  | 'rematch_decline'
  | 'victory'
  | 'defeat'
  | 'draw'
  | 'timer_warning'
  | 'copy_invite'
  | 'error_notice';

export interface AudioPreferences {
  masterMute: boolean;
  sfxVolume: number;
  musicVolume: number;
  musicEnabled: boolean;
}

const DEFAULT_AUDIO_PREFS: AudioPreferences = {
  masterMute: false,
  sfxVolume: 0.75,
  musicVolume: 0.3,
  musicEnabled: false,
};

const STORAGE_KEY = 'flix_reversi_audio_prefs_v1';

export class AudioManager {
  private prefs: AudioPreferences;
  private ctx: any = null;
  private unlocked = false;
  private playedEventIds: Set<string> = new Set();
  private lastSoundTimestamps: Map<SoundEffectName, number> = new Map();
  private playHistoryLog: Array<{ sound: SoundEffectName; timestamp: number; eventId?: string }> = [];

  constructor(initialPrefs?: Partial<AudioPreferences>) {
    this.prefs = { ...DEFAULT_AUDIO_PREFS, ...this.loadPreferences(), ...initialPrefs };
  }

  private loadPreferences(): Partial<AudioPreferences> {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          return {
            masterMute: Boolean(parsed.masterMute),
            sfxVolume: typeof parsed.sfxVolume === 'number' ? Math.max(0, Math.min(1, parsed.sfxVolume)) : 0.75,
            musicVolume: typeof parsed.musicVolume === 'number' ? Math.max(0, Math.min(1, parsed.musicVolume)) : 0.3,
            musicEnabled: Boolean(parsed.musicEnabled),
          };
        }
      }
    } catch {}
    return {};
  }

  public savePreferences(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.prefs));
      }
    } catch {}
  }

  public getPreferences(): AudioPreferences {
    return { ...this.prefs };
  }

  public updatePreferences(patch: Partial<AudioPreferences>): AudioPreferences {
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

  public resetPreferences(): AudioPreferences {
    this.prefs = { ...DEFAULT_AUDIO_PREFS };
    this.savePreferences();
    return this.getPreferences();
  }

  public unlockOnUserGesture(): boolean {
    this.unlocked = true;
    try {
      if (typeof window !== 'undefined') {
        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
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

  public isUnlocked(): boolean {
    return this.unlocked;
  }

  public play(sound: SoundEffectName, options: { eventId?: string; flipCount?: number } = {}): boolean {
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
    this.playHistoryLog.push({ sound, timestamp: now, eventId: options.eventId });
    return true;
  }

  public testSound(): boolean {
    this.unlockOnUserGesture();
    return this.play('confirm');
  }

  public getPlayHistory(): ReadonlyArray<{ sound: SoundEffectName; timestamp: number; eventId?: string }> {
    return this.playHistoryLog;
  }
}
