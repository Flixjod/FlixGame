/**
 * FLIX REVERSI — Core Framework-Independent Reversi (Othello) Game Engine
 * Implements standard 8x8 Reversi rules, 8-directional capture evaluation,
 * automatic pass detection, end-of-game detection, move history, and statistics.
 */

export type PlayerColor = 'B' | 'W';
export type CellState = PlayerColor | null;
export type BoardState = CellState[][];

export interface Coordinate {
  row: number;
  col: number;
}

export interface LegalMove {
  row: number;
  col: number;
  captured: Coordinate[];
}

export interface MoveRecord {
  moveNumber: number;
  player: PlayerColor;
  row: number;
  col: number;
  notation: string;
  captured: Coordinate[];
  timestamp: number;
  blackScoreAfter: number;
  whiteScoreAfter: number;
  skippedOpponent: PlayerColor | null;
  boardSnapshot: BoardState;
}

export type GameStatus = 'playing' | 'completed';
export type EndReason = 'board_full' | 'no_legal_moves' | 'resignation' | 'timeout' | null;

export interface GameEventRecord {
  eventId: string;
  type: 'MOVE_ACCEPTED' | 'DISCS_FLIPPED' | 'TURN_CHANGED' | 'TURN_SKIPPED' | 'GAME_COMPLETED' | 'ILLEGAL_MOVE';
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface GameState {
  id: string;
  board: BoardState;
  currentTurn: PlayerColor;
  status: GameStatus;
  winner: PlayerColor | 'draw' | null;
  endReason: EndReason;
  blackScore: number;
  whiteScore: number;
  emptyCount: number;
  moveHistory: MoveRecord[];
  skippedTurns: { B: number; W: number };
  legalMoves: LegalMove[];
  lastMove: { row: number; col: number; player: PlayerColor; captured: Coordinate[] } | null;
  lastSkippedPlayer: PlayerColor | null;
  startedAt: number;
  completedAt: number | null;
  version: number;
}

export interface MoveExecutionResult {
  accepted: boolean;
  error?: string;
  state: GameState;
  moveRecord?: MoveRecord;
  events: GameEventRecord[];
}

export interface MatchStatistics {
  winner: PlayerColor | 'draw' | null;
  blackScore: number;
  whiteScore: number;
  winningMargin: number;
  occupiedSquares: number;
  emptySquares: number;
  totalMoves: number;
  skippedTurns: { B: number; W: number };
  durationMs: number;
  endReason: EndReason;
  maxLeadBlack: number;
  maxLeadWhite: number;
  totalCapturesBlack: number;
  totalCapturesWhite: number;
  cornersCaptured: { B: number; W: number };
}

export const BOARD_SIZE = 8;

export const DIRECTIONS: readonly Coordinate[] = [
  { row: -1, col: -1 }, // NW
  { row: -1, col: 0 },  // N
  { row: -1, col: 1 },  // NE
  { row: 0, col: -1 },  // W
  { row: 0, col: 1 },   // E
  { row: 1, col: -1 },  // SW
  { row: 1, col: 0 },   // S
  { row: 1, col: 1 },   // SE
];

export function getOpponentColor(player: PlayerColor): PlayerColor {
  return player === 'B' ? 'W' : 'B';
}

export function getPlayerName(player: PlayerColor): string {
  return player === 'B' ? 'Black' : 'White';
}

export function toAlgebraicNotation(row: number, col: number): string {
  const colChar = String.fromCharCode(65 + col);
  const rowChar = String(row + 1);
  return `${colChar}${rowChar}`;
}

export function isInsideBoard(row: number, col: number): boolean {
  return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

export function createEmptyBoard(): BoardState {
  return Array.from({ length: BOARD_SIZE }, () => Array<CellState>(BOARD_SIZE).fill(null));
}

/**
 * Creates the standard 8x8 Reversi starting board:
 * (3,3) = White, (3,4) = Black, (4,3) = Black, (4,4) = White
 */
export function createInitialBoard(): BoardState {
  const board = createEmptyBoard();
  board[3][3] = 'W';
  board[3][4] = 'B';
  board[4][3] = 'B';
  board[4][4] = 'W';
  return board;
}

export function cloneBoard(board: BoardState): BoardState {
  return board.map((row) => [...row]);
}

export function calculateScores(board: BoardState): { black: number; white: number; empty: number } {
  let black = 0;
  let white = 0;
  let empty = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = board[r][c];
      if (cell === 'B') black++;
      else if (cell === 'W') white++;
      else empty++;
    }
  }
  return { black, white, empty };
}

/**
 * Evaluates all 8 directions from (row, col) and returns every opponent disc
 * that would be bracketed and captured by placing `player` at (row, col).
 */
export function getCapturedDiscs(
  board: BoardState,
  row: number,
  col: number,
  player: PlayerColor
): Coordinate[] {
  if (!isInsideBoard(row, col) || board[row][col] !== null) {
    return [];
  }
  const opponent = getOpponentColor(player);
  const captured: Coordinate[] = [];

  for (const dir of DIRECTIONS) {
    const line: Coordinate[] = [];
    let r = row + dir.row;
    let c = col + dir.col;

    while (isInsideBoard(r, c) && board[r][c] === opponent) {
      line.push({ row: r, col: c });
      r += dir.row;
      c += dir.col;
    }

    if (line.length > 0 && isInsideBoard(r, c) && board[r][c] === player) {
      captured.push(...line);
    }
  }

  return captured;
}

export function getLegalMoves(board: BoardState, player: PlayerColor): LegalMove[] {
  const moves: LegalMove[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === null) {
        const captured = getCapturedDiscs(board, r, c, player);
        if (captured.length > 0) {
          moves.push({ row: r, col: c, captured });
        }
      }
    }
  }
  return moves;
}

export function isValidMove(
  board: BoardState,
  row: number,
  col: number,
  player: PlayerColor
): boolean {
  return getCapturedDiscs(board, row, col, player).length > 0;
}

export function detectGameCompletion(board: BoardState): {
  completed: boolean;
  reason: EndReason;
  blackLegalMoves: LegalMove[];
  whiteLegalMoves: LegalMove[];
} {
  const scores = calculateScores(board);
  const blackLegalMoves = getLegalMoves(board, 'B');
  const whiteLegalMoves = getLegalMoves(board, 'W');

  if (scores.empty === 0) {
    return { completed: true, reason: 'board_full', blackLegalMoves, whiteLegalMoves };
  }
  if (blackLegalMoves.length === 0 && whiteLegalMoves.length === 0) {
    return { completed: true, reason: 'no_legal_moves', blackLegalMoves, whiteLegalMoves };
  }
  return { completed: false, reason: null, blackLegalMoves, whiteLegalMoves };
}

export function determineWinner(blackScore: number, whiteScore: number): PlayerColor | 'draw' {
  if (blackScore > whiteScore) return 'B';
  if (whiteScore > blackScore) return 'W';
  return 'draw';
}

export interface CreateGameOptions {
  id?: string;
  board?: BoardState;
  startingPlayer?: PlayerColor;
  now?: number;
}

export function createNewGame(options: CreateGameOptions = {}): GameState {
  const now = options.now ?? Date.now();
  const id = options.id ?? `match_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const board = options.board ? cloneBoard(options.board) : createInitialBoard();
  const startingPlayer: PlayerColor = options.startingPlayer ?? 'B';
  const scores = calculateScores(board);
  const completion = detectGameCompletion(board);

  let currentTurn: PlayerColor = startingPlayer;
  let legalMoves = currentTurn === 'B' ? completion.blackLegalMoves : completion.whiteLegalMoves;
  const skippedTurns = { B: 0, W: 0 };
  let lastSkippedPlayer: PlayerColor | null = null;

  if (!completion.completed && legalMoves.length === 0) {
    lastSkippedPlayer = currentTurn;
    skippedTurns[currentTurn]++;
    currentTurn = getOpponentColor(currentTurn);
    legalMoves = currentTurn === 'B' ? completion.blackLegalMoves : completion.whiteLegalMoves;
  }

  const status: GameStatus = completion.completed ? 'completed' : 'playing';
  const winner = completion.completed ? determineWinner(scores.black, scores.white) : null;

  return {
    id,
    board,
    currentTurn,
    status,
    winner,
    endReason: completion.reason,
    blackScore: scores.black,
    whiteScore: scores.white,
    emptyCount: scores.empty,
    moveHistory: [],
    skippedTurns,
    legalMoves: completion.completed ? [] : legalMoves,
    lastMove: null,
    lastSkippedPlayer,
    startedAt: now,
    completedAt: completion.completed ? now : null,
    version: 1,
  };
}

/**
 * Applies a move for the active player (or verified `player`), flips captured discs,
 * automatically skips turns if the next player has no legal moves, and detects completion.
 * Does NOT mutate the input `state`.
 */
export function applyMove(
  state: GameState,
  row: number,
  col: number,
  player: PlayerColor = state.currentTurn,
  now: number = Date.now()
): MoveExecutionResult {
  const events: GameEventRecord[] = [];
  const nextVersion = state.version + 1;

  if (state.status !== 'playing') {
    events.push({
      eventId: `${state.id}_illegal_${nextVersion}_${row}_${col}`,
      type: 'ILLEGAL_MOVE',
      timestamp: now,
      payload: { reason: 'Match has already ended', row, col, player },
    });
    return {
      accepted: false,
      error: 'Match has already ended.',
      state,
      events,
    };
  }

  if (player !== state.currentTurn) {
    events.push({
      eventId: `${state.id}_illegal_${nextVersion}_${row}_${col}`,
      type: 'ILLEGAL_MOVE',
      timestamp: now,
      payload: { reason: `It is ${getPlayerName(state.currentTurn)}'s turn`, row, col, player },
    });
    return {
      accepted: false,
      error: `Out of turn: it is ${getPlayerName(state.currentTurn)}'s turn.`,
      state,
      events,
    };
  }

  const captured = getCapturedDiscs(state.board, row, col, player);
  if (captured.length === 0) {
    events.push({
      eventId: `${state.id}_illegal_${nextVersion}_${row}_${col}`,
      type: 'ILLEGAL_MOVE',
      timestamp: now,
      payload: { reason: 'Move does not bracket any opponent discs', row, col, player },
    });
    return {
      accepted: false,
      error: 'Illegal move: must bracket at least one opponent disc.',
      state,
      events,
    };
  }

  const nextBoard = cloneBoard(state.board);
  nextBoard[row][col] = player;
  for (const pos of captured) {
    nextBoard[pos.row][pos.col] = player;
  }

  const scores = calculateScores(nextBoard);
  const moveNumber = state.moveHistory.length + 1;
  const opponent = getOpponentColor(player);
  const completion = detectGameCompletion(nextBoard);

  const nextSkippedTurns = { ...state.skippedTurns };
  let nextTurn: PlayerColor = opponent;
  let nextLegalMoves: LegalMove[] = [];
  let skippedOpponent: PlayerColor | null = null;
  let nextStatus: GameStatus = 'playing';
  let nextWinner: PlayerColor | 'draw' | null = null;
  let nextEndReason: EndReason = null;
  let nextCompletedAt: number | null = null;

  events.push({
    eventId: `${state.id}_move_${moveNumber}`,
    type: 'MOVE_ACCEPTED',
    timestamp: now,
    payload: {
      moveNumber,
      player,
      row,
      col,
      notation: toAlgebraicNotation(row, col),
      capturedCount: captured.length,
      captured,
    },
  });

  events.push({
    eventId: `${state.id}_flip_${moveNumber}`,
    type: 'DISCS_FLIPPED',
    timestamp: now,
    payload: {
      moveNumber,
      player,
      captured,
    },
  });

  if (completion.completed) {
    nextStatus = 'completed';
    nextEndReason = completion.reason;
    nextWinner = determineWinner(scores.black, scores.white);
    nextCompletedAt = now;
    nextTurn = player;
    nextLegalMoves = [];

    events.push({
      eventId: `${state.id}_complete_${moveNumber}`,
      type: 'GAME_COMPLETED',
      timestamp: now,
      payload: {
        winner: nextWinner,
        blackScore: scores.black,
        whiteScore: scores.white,
        reason: nextEndReason,
      },
    });
  } else {
    const opponentMoves = opponent === 'B' ? completion.blackLegalMoves : completion.whiteLegalMoves;
    const currentPlayerMoves = player === 'B' ? completion.blackLegalMoves : completion.whiteLegalMoves;

    if (opponentMoves.length > 0) {
      nextTurn = opponent;
      nextLegalMoves = opponentMoves;
      events.push({
        eventId: `${state.id}_turn_${moveNumber}`,
        type: 'TURN_CHANGED',
        timestamp: now,
        payload: { activePlayer: nextTurn },
      });
    } else {
      // Opponent has no legal moves, but game is not completed -> current player moves again!
      skippedOpponent = opponent;
      nextSkippedTurns[opponent] += 1;
      nextTurn = player;
      nextLegalMoves = currentPlayerMoves;

      events.push({
        eventId: `${state.id}_skip_${moveNumber}_${opponent}`,
        type: 'TURN_SKIPPED',
        timestamp: now,
        payload: {
          skippedPlayer: opponent,
          nextPlayer: player,
          message: `${getPlayerName(opponent)} has no available moves. ${getPlayerName(player)}'s turn.`,
        },
      });
    }
  }

  const moveRecord: MoveRecord = {
    moveNumber,
    player,
    row,
    col,
    notation: toAlgebraicNotation(row, col),
    captured,
    timestamp: now,
    blackScoreAfter: scores.black,
    whiteScoreAfter: scores.white,
    skippedOpponent,
    boardSnapshot: cloneBoard(nextBoard),
  };

  const nextState: GameState = {
    id: state.id,
    board: nextBoard,
    currentTurn: nextTurn,
    status: nextStatus,
    winner: nextWinner,
    endReason: nextEndReason,
    blackScore: scores.black,
    whiteScore: scores.white,
    emptyCount: scores.empty,
    moveHistory: [...state.moveHistory, moveRecord],
    skippedTurns: nextSkippedTurns,
    legalMoves: nextLegalMoves,
    lastMove: { row, col, player, captured },
    lastSkippedPlayer: skippedOpponent,
    startedAt: state.startedAt,
    completedAt: nextCompletedAt,
    version: nextVersion,
  };

  return {
    accepted: true,
    state: nextState,
    moveRecord,
    events,
  };
}

/**
 * Explicitly passes the turn when the current player has no legal moves.
 * Note: `applyMove` automatically handles turn passing after each move,
 * but `passTurn` is exposed for custom board states or explicit pass validation.
 */
export function passTurn(state: GameState, now: number = Date.now()): MoveExecutionResult {
  if (state.status !== 'playing') {
    return {
      accepted: false,
      error: 'Cannot pass turn: game is already completed.',
      state,
      events: [],
    };
  }

  const currentMoves = getLegalMoves(state.board, state.currentTurn);
  if (currentMoves.length > 0) {
    return {
      accepted: false,
      error: 'Cannot pass turn when legal moves are available.',
      state,
      events: [],
    };
  }

  const opponent = getOpponentColor(state.currentTurn);
  const opponentMoves = getLegalMoves(state.board, opponent);
  const nextVersion = state.version + 1;

  if (opponentMoves.length === 0) {
    const winner = determineWinner(state.blackScore, state.whiteScore);
    const nextState: GameState = {
      ...state,
      status: 'completed',
      winner,
      endReason: state.emptyCount === 0 ? 'board_full' : 'no_legal_moves',
      legalMoves: [],
      completedAt: now,
      version: nextVersion,
    };
    return {
      accepted: true,
      state: nextState,
      events: [
        {
          eventId: `${state.id}_complete_pass_${nextVersion}`,
          type: 'GAME_COMPLETED',
          timestamp: now,
          payload: {
            winner,
            blackScore: state.blackScore,
            whiteScore: state.whiteScore,
            reason: nextState.endReason,
          },
        },
      ],
    };
  }

  const skippedPlayer = state.currentTurn;
  const nextSkippedTurns = {
    ...state.skippedTurns,
    [skippedPlayer]: state.skippedTurns[skippedPlayer] + 1,
  };

  const nextState: GameState = {
    ...state,
    currentTurn: opponent,
    skippedTurns: nextSkippedTurns,
    legalMoves: opponentMoves,
    lastSkippedPlayer: skippedPlayer,
    version: nextVersion,
  };

  return {
    accepted: true,
    state: nextState,
    events: [
      {
        eventId: `${state.id}_skip_pass_${nextVersion}_${skippedPlayer}`,
        type: 'TURN_SKIPPED',
        timestamp: now,
        payload: {
          skippedPlayer,
          nextPlayer: opponent,
          message: `${getPlayerName(skippedPlayer)} has no available moves. ${getPlayerName(opponent)}'s turn.`,
        },
      },
    ],
  };
}

/**
 * Concludes a match immediately due to resignation or timer expiration.
 */
export function concludeGameByReason(
  state: GameState,
  reason: 'resignation' | 'timeout',
  losingPlayer: PlayerColor,
  now: number = Date.now()
): GameState {
  if (state.status === 'completed') return state;
  const winner = getOpponentColor(losingPlayer);
  return {
    ...state,
    status: 'completed',
    winner,
    endReason: reason,
    legalMoves: [],
    completedAt: now,
    version: state.version + 1,
  };
}

/**
 * Computes comprehensive match statistics from an authoritative `GameState`.
 */
export function calculateMatchStatistics(
  state: GameState,
  now: number = Date.now()
): MatchStatistics {
  const endTimestamp = state.completedAt ?? now;
  const durationMs = Math.max(0, endTimestamp - state.startedAt);
  const occupiedSquares = state.blackScore + state.whiteScore;
  const emptySquares = state.emptyCount;
  const winningMargin = Math.abs(state.blackScore - state.whiteScore);

  let maxLeadBlack = Math.max(0, state.blackScore - state.whiteScore);
  let maxLeadWhite = Math.max(0, state.whiteScore - state.blackScore);
  let totalCapturesBlack = 0;
  let totalCapturesWhite = 0;

  for (const move of state.moveHistory) {
    const diffB = move.blackScoreAfter - move.whiteScoreAfter;
    if (diffB > maxLeadBlack) maxLeadBlack = diffB;
    if (-diffB > maxLeadWhite) maxLeadWhite = -diffB;
    if (move.player === 'B') totalCapturesBlack += move.captured.length;
    else totalCapturesWhite += move.captured.length;
  }

  const corners: Coordinate[] = [
    { row: 0, col: 0 },
    { row: 0, col: 7 },
    { row: 7, col: 0 },
    { row: 7, col: 7 },
  ];
  const cornersCaptured = { B: 0, W: 0 };
  for (const corner of corners) {
    const owner = state.board[corner.row][corner.col];
    if (owner === 'B') cornersCaptured.B++;
    else if (owner === 'W') cornersCaptured.W++;
  }

  return {
    winner: state.winner,
    blackScore: state.blackScore,
    whiteScore: state.whiteScore,
    winningMargin,
    occupiedSquares,
    emptySquares,
    totalMoves: state.moveHistory.length,
    skippedTurns: { ...state.skippedTurns },
    durationMs,
    endReason: state.endReason,
    maxLeadBlack,
    maxLeadWhite,
    totalCapturesBlack,
    totalCapturesWhite,
    cornersCaptured,
  };
}
