/**
 * FLIX REVERSI — Strict TypeScript Domain Definitions
 */

export type DiscColor = 'B' | 'W';
export type CellState = DiscColor | null;
export type BoardMatrix = CellState[][];
export type GameMode = 'online' | 'ai' | 'local';
export type AIDifficulty = 'easy' | 'medium' | 'hard';
export type MatchStatus = 'waiting' | 'active' | 'completed';

export type EndReason =
  | 'board_full'
  | 'no_moves_both'
  | 'wipeout'
  | 'timeout_B'
  | 'timeout_W'
  | 'forfeit_B'
  | 'forfeit_W'
  | null;

export type ConnectionState =
  | 'Connected'
  | 'Connecting'
  | 'Reconnecting'
  | 'Opponent Disconnected'
  | 'Connection Restored'
  | 'Connection Failed'
  | 'Match Unavailable';

export interface CapturedDisc {
  row: number;
  col: number;
  direction: [number, number];
}

export interface LegalMove {
  row: number;
  col: number;
  notation: string;
  flips: CapturedDisc[];
}

export interface MoveRecord {
  moveNumber: number;
  player: DiscColor;
  row: number;
  col: number;
  notation: string;
  captured: CapturedDisc[];
  capturedCount: number;
  scoresAfter: BoardScores;
  skippedAfter: DiscColor | null;
  timestamp: number;
}

export interface BoardScores {
  B: number;
  W: number;
  empty: number;
  occupied: number;
}

export interface PlayerInfo {
  name: string;
  color: DiscColor;
  isAI: boolean;
  clientId?: string | null;
  connected?: boolean;
}

export interface MatchSnapshot {
  moveNumber: number;
  board: BoardMatrix;
  turn: DiscColor | null;
  scores: BoardScores;
  move: MoveRecord | null;
  skippedPlayer: DiscColor | null;
  timestamp: number;
}

export interface AuthoritativeGameState {
  id: string;
  mode: GameMode;
  aiDifficulty: AIDifficulty | null;
  humanColor: DiscColor;
  players: Record<DiscColor, PlayerInfo>;
  board: BoardMatrix;
  turn: DiscColor | null;
  legalMoves: LegalMove[];
  scores: BoardScores;
  status: MatchStatus;
  winner: DiscColor | 'DRAW' | null;
  endReason: EndReason;
  winningMargin: number;
  moveHistory: MoveRecord[];
  snapshots: MatchSnapshot[];
  skippedTurns: Record<DiscColor, number>;
  lastMove: MoveRecord | null;
  lastSkippedPlayer: DiscColor | null;
  startedAt: number;
  completedAt: number | null;
  version: number;
  timerConfig: {
    enabled: boolean;
    initialSeconds: number;
  };
  timers: Record<DiscColor, number>;
}
