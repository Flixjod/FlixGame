"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DIRECTIONS = exports.BOARD_SIZE = void 0;
exports.applyMove = applyMove;
exports.calculateMatchStatistics = calculateMatchStatistics;
exports.calculateScores = calculateScores;
exports.cloneBoard = cloneBoard;
exports.concludeGameByReason = concludeGameByReason;
exports.createEmptyBoard = createEmptyBoard;
exports.createInitialBoard = createInitialBoard;
exports.createNewGame = createNewGame;
exports.detectGameCompletion = detectGameCompletion;
exports.determineWinner = determineWinner;
exports.getCapturedDiscs = getCapturedDiscs;
exports.getLegalMoves = getLegalMoves;
exports.getOpponentColor = getOpponentColor;
exports.getPlayerName = getPlayerName;
exports.isInsideBoard = isInsideBoard;
exports.isValidMove = isValidMove;
exports.passTurn = passTurn;
exports.toAlgebraicNotation = toAlgebraicNotation;
/**
 * FLIX REVERSI — Core Framework-Independent Reversi (Othello) Game Engine
 * Implements standard 8x8 Reversi rules, 8-directional capture evaluation,
 * automatic pass detection, end-of-game detection, move history, and statistics.
 */

const BOARD_SIZE = 8;
exports.BOARD_SIZE = BOARD_SIZE;
const DIRECTIONS = [{
  row: -1,
  col: -1
},
// NW
{
  row: -1,
  col: 0
},
// N
{
  row: -1,
  col: 1
},
// NE
{
  row: 0,
  col: -1
},
// W
{
  row: 0,
  col: 1
},
// E
{
  row: 1,
  col: -1
},
// SW
{
  row: 1,
  col: 0
},
// S
{
  row: 1,
  col: 1
} // SE
];
exports.DIRECTIONS = DIRECTIONS;
function getOpponentColor(player) {
  return player === 'B' ? 'W' : 'B';
}
function getPlayerName(player) {
  return player === 'B' ? 'Black' : 'White';
}
function toAlgebraicNotation(row, col) {
  const colChar = String.fromCharCode(65 + col);
  const rowChar = String(row + 1);
  return `${colChar}${rowChar}`;
}
function isInsideBoard(row, col) {
  return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}
function createEmptyBoard() {
  return Array.from({
    length: BOARD_SIZE
  }, () => Array(BOARD_SIZE).fill(null));
}

/**
 * Creates the standard 8x8 Reversi starting board:
 * (3,3) = White, (3,4) = Black, (4,3) = Black, (4,4) = White
 */
function createInitialBoard() {
  const board = createEmptyBoard();
  board[3][3] = 'W';
  board[3][4] = 'B';
  board[4][3] = 'B';
  board[4][4] = 'W';
  return board;
}
function cloneBoard(board) {
  return board.map(row => [...row]);
}
function calculateScores(board) {
  let black = 0;
  let white = 0;
  let empty = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = board[r][c];
      if (cell === 'B') black++;else if (cell === 'W') white++;else empty++;
    }
  }
  return {
    black,
    white,
    empty
  };
}

/**
 * Evaluates all 8 directions from (row, col) and returns every opponent disc
 * that would be bracketed and captured by placing `player` at (row, col).
 */
function getCapturedDiscs(board, row, col, player) {
  if (!isInsideBoard(row, col) || board[row][col] !== null) {
    return [];
  }
  const opponent = getOpponentColor(player);
  const captured = [];
  for (const dir of DIRECTIONS) {
    const line = [];
    let r = row + dir.row;
    let c = col + dir.col;
    while (isInsideBoard(r, c) && board[r][c] === opponent) {
      line.push({
        row: r,
        col: c
      });
      r += dir.row;
      c += dir.col;
    }
    if (line.length > 0 && isInsideBoard(r, c) && board[r][c] === player) {
      captured.push(...line);
    }
  }
  return captured;
}
function getLegalMoves(board, player) {
  const moves = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === null) {
        const captured = getCapturedDiscs(board, r, c, player);
        if (captured.length > 0) {
          moves.push({
            row: r,
            col: c,
            captured
          });
        }
      }
    }
  }
  return moves;
}
function isValidMove(board, row, col, player) {
  return getCapturedDiscs(board, row, col, player).length > 0;
}
function detectGameCompletion(board) {
  const scores = calculateScores(board);
  const blackLegalMoves = getLegalMoves(board, 'B');
  const whiteLegalMoves = getLegalMoves(board, 'W');
  if (scores.empty === 0) {
    return {
      completed: true,
      reason: 'board_full',
      blackLegalMoves,
      whiteLegalMoves
    };
  }
  if (blackLegalMoves.length === 0 && whiteLegalMoves.length === 0) {
    return {
      completed: true,
      reason: 'no_legal_moves',
      blackLegalMoves,
      whiteLegalMoves
    };
  }
  return {
    completed: false,
    reason: null,
    blackLegalMoves,
    whiteLegalMoves
  };
}
function determineWinner(blackScore, whiteScore) {
  if (blackScore > whiteScore) return 'B';
  if (whiteScore > blackScore) return 'W';
  return 'draw';
}
function createNewGame(options = {}) {
  const now = options.now ?? Date.now();
  const id = options.id ?? `match_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const board = options.board ? cloneBoard(options.board) : createInitialBoard();
  const startingPlayer = options.startingPlayer ?? 'B';
  const scores = calculateScores(board);
  const completion = detectGameCompletion(board);
  let currentTurn = startingPlayer;
  let legalMoves = currentTurn === 'B' ? completion.blackLegalMoves : completion.whiteLegalMoves;
  const skippedTurns = {
    B: 0,
    W: 0
  };
  let lastSkippedPlayer = null;
  if (!completion.completed && legalMoves.length === 0) {
    lastSkippedPlayer = currentTurn;
    skippedTurns[currentTurn]++;
    currentTurn = getOpponentColor(currentTurn);
    legalMoves = currentTurn === 'B' ? completion.blackLegalMoves : completion.whiteLegalMoves;
  }
  const status = completion.completed ? 'completed' : 'playing';
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
    version: 1
  };
}

/**
 * Applies a move for the active player (or verified `player`), flips captured discs,
 * automatically skips turns if the next player has no legal moves, and detects completion.
 * Does NOT mutate the input `state`.
 */
function applyMove(state, row, col, player = state.currentTurn, now = Date.now()) {
  const events = [];
  const nextVersion = state.version + 1;
  if (state.status !== 'playing') {
    events.push({
      eventId: `${state.id}_illegal_${nextVersion}_${row}_${col}`,
      type: 'ILLEGAL_MOVE',
      timestamp: now,
      payload: {
        reason: 'Match has already ended',
        row,
        col,
        player
      }
    });
    return {
      accepted: false,
      error: 'Match has already ended.',
      state,
      events
    };
  }
  if (player !== state.currentTurn) {
    events.push({
      eventId: `${state.id}_illegal_${nextVersion}_${row}_${col}`,
      type: 'ILLEGAL_MOVE',
      timestamp: now,
      payload: {
        reason: `It is ${getPlayerName(state.currentTurn)}'s turn`,
        row,
        col,
        player
      }
    });
    return {
      accepted: false,
      error: `Out of turn: it is ${getPlayerName(state.currentTurn)}'s turn.`,
      state,
      events
    };
  }
  const captured = getCapturedDiscs(state.board, row, col, player);
  if (captured.length === 0) {
    events.push({
      eventId: `${state.id}_illegal_${nextVersion}_${row}_${col}`,
      type: 'ILLEGAL_MOVE',
      timestamp: now,
      payload: {
        reason: 'Move does not bracket any opponent discs',
        row,
        col,
        player
      }
    });
    return {
      accepted: false,
      error: 'Illegal move: must bracket at least one opponent disc.',
      state,
      events
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
  const nextSkippedTurns = {
    ...state.skippedTurns
  };
  let nextTurn = opponent;
  let nextLegalMoves = [];
  let skippedOpponent = null;
  let nextStatus = 'playing';
  let nextWinner = null;
  let nextEndReason = null;
  let nextCompletedAt = null;
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
      captured
    }
  });
  events.push({
    eventId: `${state.id}_flip_${moveNumber}`,
    type: 'DISCS_FLIPPED',
    timestamp: now,
    payload: {
      moveNumber,
      player,
      captured
    }
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
        reason: nextEndReason
      }
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
        payload: {
          activePlayer: nextTurn
        }
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
          message: `${getPlayerName(opponent)} has no available moves. ${getPlayerName(player)}'s turn.`
        }
      });
    }
  }
  const moveRecord = {
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
    boardSnapshot: cloneBoard(nextBoard)
  };
  const nextState = {
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
    lastMove: {
      row,
      col,
      player,
      captured
    },
    lastSkippedPlayer: skippedOpponent,
    startedAt: state.startedAt,
    completedAt: nextCompletedAt,
    version: nextVersion
  };
  return {
    accepted: true,
    state: nextState,
    moveRecord,
    events
  };
}

/**
 * Explicitly passes the turn when the current player has no legal moves.
 * Note: `applyMove` automatically handles turn passing after each move,
 * but `passTurn` is exposed for custom board states or explicit pass validation.
 */
function passTurn(state, now = Date.now()) {
  if (state.status !== 'playing') {
    return {
      accepted: false,
      error: 'Cannot pass turn: game is already completed.',
      state,
      events: []
    };
  }
  const currentMoves = getLegalMoves(state.board, state.currentTurn);
  if (currentMoves.length > 0) {
    return {
      accepted: false,
      error: 'Cannot pass turn when legal moves are available.',
      state,
      events: []
    };
  }
  const opponent = getOpponentColor(state.currentTurn);
  const opponentMoves = getLegalMoves(state.board, opponent);
  const nextVersion = state.version + 1;
  if (opponentMoves.length === 0) {
    const winner = determineWinner(state.blackScore, state.whiteScore);
    const nextState = {
      ...state,
      status: 'completed',
      winner,
      endReason: state.emptyCount === 0 ? 'board_full' : 'no_legal_moves',
      legalMoves: [],
      completedAt: now,
      version: nextVersion
    };
    return {
      accepted: true,
      state: nextState,
      events: [{
        eventId: `${state.id}_complete_pass_${nextVersion}`,
        type: 'GAME_COMPLETED',
        timestamp: now,
        payload: {
          winner,
          blackScore: state.blackScore,
          whiteScore: state.whiteScore,
          reason: nextState.endReason
        }
      }]
    };
  }
  const skippedPlayer = state.currentTurn;
  const nextSkippedTurns = {
    ...state.skippedTurns,
    [skippedPlayer]: state.skippedTurns[skippedPlayer] + 1
  };
  const nextState = {
    ...state,
    currentTurn: opponent,
    skippedTurns: nextSkippedTurns,
    legalMoves: opponentMoves,
    lastSkippedPlayer: skippedPlayer,
    version: nextVersion
  };
  return {
    accepted: true,
    state: nextState,
    events: [{
      eventId: `${state.id}_skip_pass_${nextVersion}_${skippedPlayer}`,
      type: 'TURN_SKIPPED',
      timestamp: now,
      payload: {
        skippedPlayer,
        nextPlayer: opponent,
        message: `${getPlayerName(skippedPlayer)} has no available moves. ${getPlayerName(opponent)}'s turn.`
      }
    }]
  };
}

/**
 * Concludes a match immediately due to resignation or timer expiration.
 */
function concludeGameByReason(state, reason, losingPlayer, now = Date.now()) {
  if (state.status === 'completed') return state;
  const winner = getOpponentColor(losingPlayer);
  return {
    ...state,
    status: 'completed',
    winner,
    endReason: reason,
    legalMoves: [],
    completedAt: now,
    version: state.version + 1
  };
}

/**
 * Computes comprehensive match statistics from an authoritative `GameState`.
 */
function calculateMatchStatistics(state, now = Date.now()) {
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
    if (move.player === 'B') totalCapturesBlack += move.captured.length;else totalCapturesWhite += move.captured.length;
  }
  const corners = [{
    row: 0,
    col: 0
  }, {
    row: 0,
    col: 7
  }, {
    row: 7,
    col: 0
  }, {
    row: 7,
    col: 7
  }];
  const cornersCaptured = {
    B: 0,
    W: 0
  };
  for (const corner of corners) {
    const owner = state.board[corner.row][corner.col];
    if (owner === 'B') cornersCaptured.B++;else if (owner === 'W') cornersCaptured.W++;
  }
  return {
    winner: state.winner,
    blackScore: state.blackScore,
    whiteScore: state.whiteScore,
    winningMargin,
    occupiedSquares,
    emptySquares,
    totalMoves: state.moveHistory.length,
    skippedTurns: {
      ...state.skippedTurns
    },
    durationMs,
    endReason: state.endReason,
    maxLeadBlack,
    maxLeadWhite,
    totalCapturesBlack,
    totalCapturesWhite,
    cornersCaptured
  };
}