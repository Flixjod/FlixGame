/**
 * FLIX REVERSI — Settings, Accessibility, and Match History Manager
 * Persists user preferences locally and respects OS reduced-motion media queries.
 */

export const DEFAULT_SETTINGS = Object.freeze({
  reducedMotion: false,
  respectSystemReducedMotion: true,
  showLegalMoves: true,
  showCapturePreview: true,
  defaultDiscColor: 'B',
  defaultTimerSeconds: 0, // 0 = untimed, 180 = 3m, 300 = 5m, 600 = 10m
  defaultAiDifficulty: 'medium',
  playerName: 'Player One',
  localSecondPlayerName: 'Player Two',
  tutorialCompleted: false,
});

export class SettingsManager {
  constructor(options = {}) {
    this.storageKey = options.storageKey || 'flix_reversi_settings_v1';
    this.historyKey = options.historyKey || 'flix_reversi_match_history_v1';
    this.systemPrefersReducedMotion = Boolean(options.systemPrefersReducedMotion);
    this.settings = { ...DEFAULT_SETTINGS };
    /** @type {Array<Object>} */
    this.matchHistory = [];
    this.load();
  }

  load() {
    try {
      if (typeof localStorage !== 'undefined') {
        const rawSettings = localStorage.getItem(this.storageKey);
        if (rawSettings) {
          this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(rawSettings) };
        }
        const rawHistory = localStorage.getItem(this.historyKey);
        if (rawHistory) {
          const parsed = JSON.parse(rawHistory);
          if (Array.isArray(parsed)) this.matchHistory = parsed;
        }
      }
    } catch (_) {
      // Fallback to in-memory settings
    }
  }

  save() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(this.settings));
        localStorage.setItem(this.historyKey, JSON.stringify(this.matchHistory.slice(0, 30)));
      }
    } catch (_) {
      // Ignore sandbox storage errors
    }
  }

  update(partial) {
    this.settings = { ...this.settings, ...partial };
    this.save();
    return this.getEffectiveSettings();
  }

  reset() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.save();
    return this.getEffectiveSettings();
  }

  isReducedMotionActive() {
    if (this.settings.reducedMotion) return true;
    if (this.settings.respectSystemReducedMotion && this.systemPrefersReducedMotion) return true;
    return false;
  }

  getEffectiveSettings() {
    return {
      ...this.settings,
      effectiveReducedMotion: this.isReducedMotionActive(),
      discFlipDurationMs: this.isReducedMotionActive() ? 0 : 320,
      uiTransitionDurationMs: this.isReducedMotionActive() ? 0 : 200,
    };
  }

  recordCompletedMatch(matchSummary) {
    const entry = {
      id: matchSummary.matchId || `hist_${Date.now()}`,
      mode: matchSummary.mode,
      aiDifficulty: matchSummary.aiDifficulty || null,
      winner: matchSummary.winner,
      blackScore: matchSummary.blackScore,
      whiteScore: matchSummary.whiteScore,
      winningMargin: matchSummary.winningMargin,
      totalMoves: matchSummary.totalMoves,
      formattedDuration: matchSummary.formattedDuration,
      players: matchSummary.players,
      completedAt: Date.now(),
    };
    this.matchHistory = [entry, ...this.matchHistory.filter((m) => m.id !== entry.id)].slice(0, 30);
    this.save();
    return entry;
  }
}
