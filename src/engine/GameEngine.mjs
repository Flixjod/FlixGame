/**
 * FLIX REVERSI — Core Framework-Independent Reversi (Othello) Game Engine
 * Implements standard 8x8 rules, 8-direction bracket validation, disc flipping,
 * automatic pass detection, move history, and match statistics calculation.
 */

export const BLACK = 'B';
export const WHITE = 'W';
export const EMPTY = null;
export const BOARD_SIZE = 8;

export const DIRECTIONS = Object.freeze([
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
]);

/**
 * Returns the opponent color for a given player color.
 * @param {'B'|'W'} color
 * @returns {'B'|'W'}
 */
export function getOpponent(color) {
  if (color !== BLACK && color !== WHITE) {
    throw new Error(`Invalid player color: ${color}`);
  }
  return color === BLACK ? WHITE : BLACK;
}

/**
 * Creates a standard 8x8 Reversi board with the 4 center discs:
 * (3,3)=White, (3,4)=Black, (4,3)=Black, (4,4)=White
 * @returns {Array<Array<'B'|'W'|null>>}
 */
export function createInitialBoard() {
  const board = Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(EMPTY)
  );
  board[3][3] = WHITE;
  board[3][4] = BLACK;
  board[4][3] = BLACK;
  board[4][4] = WHITE;
  return board;
}

/**
 * Deep-clones an 8x8 board matrix.
 * @param {Array<Array<'B'|'W'|null>>} board
 * @returns {Array<Array<'B'|'W'|null>>}
 */
export function cloneBoard(board) {
  return board.map((row) => [...row]);
}

/**
 * Checks whether (row, col) is inside the 8x8 board.
 * @param {number} row
 * @param {number} col
 * @returns {boolean}
 */
export function isInBounds(row, col) {
  return (
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    row >= 0 &&
    row < BOARD_SIZE &&
    col >= 0 &&
    col < BOARD_SIZE
  );
}

/**
 * Converts (row, col) to standard algebraic notation (e.g., (2, 3) -> "d3").
 * @param {number} row
 * @param {number} col
 * @returns {string}
 */
export function toNotation(row, col) {
  const file = String.fromCharCode(97 + col);
  const rank = row + 1;
  return `${file}${rank}`;
}

/**
 * Determines all opponent discs that would be captured if `color` places a disc at (row, col).
 * Evaluates all 8 directions. Returns an empty array if the move is illegal.
 * @param {Array<Array<'B'|'W'|null>>} board
 * @param {number} row
 * @param {number} col
 * @param {'B'|'W'} color
 * @returns {Array<{row: number, col: number, direction: [number, number]}>}
 */
export function getCapturedDiscs(board, row, col, color) {
  if (!isInBounds(row, col) || board[row][col] !== EMPTY) {
    return [];
  }
  const opponent = getOpponent(color);
  const allCaptured = [];

  for (const [dr, dc] of DIRECTIONS) {
    const lineCaptured = [];
    let r = row + dr;
    let c = col + dc;

    while (isInBounds(r, c) && board[r][c] === opponent) {
      lineCaptured.push({ row: r, col: c, direction: [dr, dc] });
      r += dr;
      c += dc;
    }

    if (lineCaptured.length > 0 && isInBounds(r, c) && board[r][c] === color) {
      allCaptured.push(...lineCaptured);
    }
  }

  return allCaptured;
}

/**
 * Calculates all legal moves for `color` on `board`.
 * Each legal move entry includes `row`, `col`, `notation`, and `flips` (captured discs).
 * @param {Array<Array<'B'|'W'|null>>} board
 * @param {'B'|'W'} color
 * @returns {Array<{row: number, col: number, notation: string, flips: Array<{row: number, col: number, direction: [number, number]}>}>}
 */
export function calculateLegalMoves(board, color) {
  const moves = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== EMPTY) continue;
      const flips = getCapturedDiscs(board, r, c, color);
      if (flips.length > 0) {
        moves.push({
          row: r,
          col: c,
          notation: toNotation(r, c),
          flips,
        });
      }
    }
  }
  return moves;
}

/**
 * Calculates current disc counts and empty squares on `board`.
 * @param {Array<Array<'B'|'W'|null>>} board
 * @returns {{ B: number, W: number, empty: number, occupied: number }}
 */
export function calculateScores(board) {
  let b = 0;
  let w = 0;
  let empty = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = board[r][c];
      if (cell === BLACK) b++;
      else if (cell === WHITE) w++;
      else empty++;
    }
  }
  return { B: b, W: w, empty, occupied: b + w };
}

/**
 * Evaluates whether the game is complete and determines the next turn or pass state.
 * @param {Array<Array<'B'|'W'|null>>} board
 * @param {'B'|'W'} nextCandidateColor
 * @returns {{
 *   isGameOver: boolean,
 *   nextTurn: 'B'|'W'|null,
 *   legalMoves: Array,
 *   skippedPlayer: 'B'|'W'|null,
 *   endReason: 'board_full'|'no_moves_both'|'wipeout'|null
 * }}
 */
export function resolveTurnProgression(board, nextCandidateColor) {
  const scores = calculateScores(board);

  // Check if one side has been completely wiped out or board is full
  if (scores.empty === 0) {
    return {
      isGameOver: true,
      nextTurn: null,
      legalMoves: [],
      skippedPlayer: null,
      endReason: 'board_full',
    };
  }

  if (scores.B === 0 || scores.W === 0) {
    return {
      isGameOver: true,
      nextTurn: null,
      legalMoves: [],
      skippedPlayer: null,
      endReason: 'wipeout',
    };
  }

  const candidateMoves = calculateLegalMoves(board, nextCandidateColor);
  if (candidateMoves.length > 0) {
    return {
      isGameOver: false,
      nextTurn: nextCandidateColor,
      legalMoves: candidateMoves,
      skippedPlayer: null,
      endReason: null,
    };
  }

  // Candidate has no legal moves -> check if the other player has legal moves
  const otherColor = getOpponent(nextCandidateColor);
  const otherMoves = calculateLegalMoves(board, otherColor);
  if (otherMoves.length > 0) {
    return {
      isGameOver: false,
      nextTurn: otherColor,
      legalMoves: otherMoves,
      skippedPlayer: nextCandidateColor,
      endReason: null,
    };
  }

  // Neither player can move -> game over
  return {
    isGameOver: true,
    nextTurn: null,
    legalMoves: [],
    skippedPlayer: null,
    endReason: 'no_moves_both',
  };
}

/**
 * Creates a fresh authoritative game state object.
 * @param {Object} [options]
 * @returns {Object} Authoritative game state
 */
export function createNewGame(options = {}) {
  const board = options.initialBoard ? cloneBoard(options.initialBoard) : createInitialBoard();
  const startingTurn = options.startingTurn || BLACK;
  const now = options.timestamp || Date.now();
  const scores = calculateScores(board);
  const progression = resolveTurnProgression(board, startingTurn);

  const initialSnapshot = {
    moveNumber: 0,
    board: cloneBoard(board),
    turn: progression.nextTurn,
    scores: { ...scores },
    move: null,
    skippedPlayer: progression.skippedPlayer,
    timestamp: now,
  };

  const state = {
    id: options.id || `match_${now}_${Math.random().toString(36).slice(2, 8)}`,
    mode: options.mode || 'local', // 'local' | 'ai' | 'online'
    aiDifficulty: options.aiDifficulty || null, // 'easy' | 'medium' | 'hard' | null
    humanColor: options.humanColor || BLACK,
    players: {
      B: {
        name: options.players?.B?.name || 'Black',
        color: BLACK,
        isAI: Boolean(options.players?.B?.isAI),
      },
      W: {
        name: options.players?.W?.name || 'White',
        color: WHITE,
        isAI: Boolean(options.players?.W?.isAI),
      },
    },
    board,
    turn: progression.nextTurn,
    legalMoves: progression.legalMoves,
    scores,
    status: progression.isGameOver ? 'completed' : 'active',
    winner: null,
    endReason: progression.endReason,
    winningMargin: 0,
    moveHistory: [],
    snapshots: [initialSnapshot],
    skippedTurns: {
      B: progression.skippedPlayer === BLACK ? 1 : 0,
      W: progression.skippedPlayer === WHITE ? 1 : 0,
    },
    lastMove: null,
    lastSkippedPlayer: progression.skippedPlayer,
    startedAt: now,
    completedAt: progression.isGameOver ? now : null,
    version: 1,
    timerConfig: {
      enabled: Boolean(options.timerSeconds && options.timerSeconds > 0),
      initialSeconds: options.timerSeconds || 0,
    },
    timers: {
      B: options.timerSeconds || 0,
      W: options.timerSeconds || 0,
    },
  };

  if (state.status === 'completed') {
    finalizeMatchResult(state, now);
  }

  return state;
}

/**
 * Computes winner, draw state, and winning margin when a game finishes.
 * @param {Object} state
 * @param {number} [completedAt]
 * @param {string} [overrideReason]
 */
export function finalizeMatchResult(state, completedAt = Date.now(), overrideReason = null) {
  state.status = 'completed';
  state.turn = null;
  state.legalMoves = [];
  state.completedAt = completedAt;
  if (overrideReason) {
    state.endReason = overrideReason;
  }

  const { B, W } = state.scores;
  state.winningMargin = Math.abs(B - W);

  if (overrideReason === 'timeout_B') {
    state.winner = WHITE;
  } else if (overrideReason === 'timeout_W') {
    state.winner = BLACK;
  } else if (overrideReason === 'forfeit_B') {
    state.winner = WHITE;
  } else if (overrideReason === 'forfeit_W') {
    state.winner = BLACK;
  } else if (B > W) {
    state.winner = BLACK;
  } else if (W > B) {
    state.winner = WHITE;
  } else {
    state.winner = 'DRAW';
  }

  return state;
}

/**
 * Applies a move for the active player at (row, col).
 * Rejects illegal moves without mutating the provided state.
 * Returns a rich result containing the next immutable state and emitted events.
 *
 * @param {Object} currentState
 * @param {number} row
 * @param {number} col
 * @param {'B'|'W'} [playerColor] - optional explicit player assertion
 * @param {number} [timestamp]
 * @returns {{
 *   accepted: boolean,
 *   reason?: string,
 *   state: Object,
 *   moveRecord?: Object,
 *   events: Array<{type: string, payload: Object}>
 * }}
 */
export function applyMove(currentState, row, col, playerColor = currentState.turn, timestamp = Date.now()) {
  if (currentState.status !== 'active' || !currentState.turn) {
    return {
      accepted: false,
      reason: 'GAME_NOT_ACTIVE',
      state: currentState,
      events: [{ type: 'ILLEGAL_MOVE_REJECTED', payload: { row, col, playerColor, reason: 'GAME_NOT_ACTIVE' } }],
    };
  }

  if (playerColor !== currentState.turn) {
    return {
      accepted: false,
      reason: 'OUT_OF_TURN',
      state: currentState,
      events: [{ type: 'ILLEGAL_MOVE_REJECTED', payload: { row, col, playerColor, reason: 'OUT_OF_TURN' } }],
    };
  }

  if (!isInBounds(row, col)) {
    return {
      accepted: false,
      reason: 'OUT_OF_BOUNDS',
      state: currentState,
      events: [{ type: 'ILLEGAL_MOVE_REJECTED', payload: { row, col, playerColor, reason: 'OUT_OF_BOUNDS' } }],
    };
  }

  if (currentState.board[row][col] !== EMPTY) {
    return {
      accepted: false,
      reason: 'CELL_OCCUPIED',
      state: currentState,
      events: [{ type: 'ILLEGAL_MOVE_REJECTED', payload: { row, col, playerColor, reason: 'CELL_OCCUPIED' } }],
    };
  }

  const captured = getCapturedDiscs(currentState.board, row, col, playerColor);
  if (captured.length === 0) {
    return {
      accepted: false,
      reason: 'NO_BRACKETED_DISCS',
      state: currentState,
      events: [{ type: 'ILLEGAL_MOVE_REJECTED', payload: { row, col, playerColor, reason: 'NO_BRACKETED_DISCS' } }],
    };
  }

  // Clone board and apply disc placement + flips
  const nextBoard = cloneBoard(currentState.board);
  nextBoard[row][col] = playerColor;
  for (const { row: cr, col: cc } of captured) {
    nextBoard[cr][cc] = playerColor;
  }

  const nextScores = calculateScores(nextBoard);
  const opponentColor = getOpponent(playerColor);
  const progression = resolveTurnProgression(nextBoard, opponentColor);

  const moveNumber = currentState.moveHistory.length + 1;
  const moveRecord = {
    moveNumber,
    player: playerColor,
    row,
    col,
    notation: toNotation(row, col),
    captured: captured.map((c) => ({ row: c.row, col: c.col, direction: c.direction })),
    capturedCount: captured.length,
    scoresAfter: { ...nextScores },
    skippedAfter: progression.skippedPlayer,
    timestamp,
  };

  const nextSkippedTurns = {
    B: currentState.skippedTurns.B + (progression.skippedPlayer === BLACK ? 1 : 0),
    W: currentState.skippedTurns.W + (progression.skippedPlayer === WHITE ? 1 : 0),
  };

  const snapshot = {
    moveNumber,
    board: cloneBoard(nextBoard),
    turn: progression.nextTurn,
    scores: { ...nextScores },
    move: moveRecord,
    skippedPlayer: progression.skippedPlayer,
    timestamp,
  };

  const nextState = {
    ...currentState,
    board: nextBoard,
    turn: progression.nextTurn,
    legalMoves: progression.legalMoves,
    scores: nextScores,
    status: progression.isGameOver ? 'completed' : 'active',
    endReason: progression.endReason,
    moveHistory: [...currentState.moveHistory, moveRecord],
    snapshots: [...currentState.snapshots, snapshot],
    skippedTurns: nextSkippedTurns,
    lastMove: moveRecord,
    lastSkippedPlayer: progression.skippedPlayer,
    version: (currentState.version || 1) + 1,
  };

  const events = [
    {
      type: 'MOVE_APPLIED',
      payload: {
        eventId: `${nextState.id}_move_${moveNumber}`,
        move: moveRecord,
        version: nextState.version,
      },
    },
    {
      type: 'DISCS_FLIPPED',
      payload: {
        eventId: `${nextState.id}_flips_${moveNumber}`,
        player: playerColor,
        placedAt: { row, col },
        captured: moveRecord.captured,
      },
    },
  ];

  if (progression.isGameOver) {
    finalizeMatchResult(nextState, timestamp, progression.endReason);
    events.push({
      type: 'MATCH_COMPLETED',
      payload: {
        eventId: `${nextState.id}_completed_${nextState.version}`,
        winner: nextState.winner,
        scores: nextState.scores,
        winningMargin: nextState.winningMargin,
        endReason: nextState.endReason,
        statistics: calculateMatchStatistics(nextState),
      },
    });
  } else {
    if (progression.skippedPlayer) {
      events.push({
        type: 'TURN_SKIPPED',
        payload: {
          eventId: `${nextState.id}_skip_${moveNumber}_${progression.skippedPlayer}`,
          skippedPlayer: progression.skippedPlayer,
          nextTurn: progression.nextTurn,
          moveNumber,
        },
      });
    }
    events.push({
      type: 'TURN_CHANGED',
      payload: {
        eventId: `${nextState.id}_turn_${moveNumber}_${progression.nextTurn}`,
        turn: progression.nextTurn,
        legalMovesCount: progression.legalMoves.length,
      },
    });
  }

  return {
    accepted: true,
    state: nextState,
    moveRecord,
    events,
  };
}

/**
 * Explicitly passes the current player's turn ONLY if they genuinely have no legal moves.
 * (Note: `applyMove` already handles automatic turn skipping after a move,
 *  and `passTurn` is exposed for custom board setups or explicit pass verification).
 * @param {Object} currentState
 * @param {number} [timestamp]
 * @returns {{ accepted: boolean, reason?: string, state: Object, events: Array }}
 */
export function passTurn(currentState, timestamp = Date.now()) {
  if (currentState.status !== 'active' || !currentState.turn) {
    return { accepted: false, reason: 'GAME_NOT_ACTIVE', state: currentState, events: [] };
  }

  const currentMoves = calculateLegalMoves(currentState.board, currentState.turn);
  if (currentMoves.length > 0) {
    return {
      accepted: false,
      reason: 'HAS_LEGAL_MOVES',
      state: currentState,
      events: [],
    };
  }

  const skippedColor = currentState.turn;
  const otherColor = getOpponent(skippedColor);
  const otherMoves = calculateLegalMoves(currentState.board, otherColor);

  if (otherMoves.length === 0) {
    const nextState = {
      ...currentState,
      board: cloneBoard(currentState.board),
      version: (currentState.version || 1) + 1,
    };
    finalizeMatchResult(nextState, timestamp, 'no_moves_both');
    return {
      accepted: true,
      state: nextState,
      events: [
        {
          type: 'MATCH_COMPLETED',
          payload: {
            eventId: `${nextState.id}_completed_${nextState.version}`,
            winner: nextState.winner,
            scores: nextState.scores,
            winningMargin: nextState.winningMargin,
            endReason: nextState.endReason,
            statistics: calculateMatchStatistics(nextState),
          },
        },
      ],
    };
  }

  const nextState = {
    ...currentState,
    turn: otherColor,
    legalMoves: otherMoves,
    skippedTurns: {
      ...currentState.skippedTurns,
      [skippedColor]: currentState.skippedTurns[skippedColor] + 1,
    },
    lastSkippedPlayer: skippedColor,
    version: (currentState.version || 1) + 1,
  };

  return {
    accepted: true,
    state: nextState,
    events: [
      {
        type: 'TURN_SKIPPED',
        payload: {
          eventId: `${nextState.id}_manual_skip_${nextState.version}_${skippedColor}`,
          skippedPlayer: skippedColor,
          nextTurn: otherColor,
          moveNumber: nextState.moveHistory.length,
        },
      },
      {
        type: 'TURN_CHANGED',
        payload: {
          eventId: `${nextState.id}_turn_${nextState.version}_${otherColor}`,
          turn: otherColor,
          legalMovesCount: otherMoves.length,
        },
      },
    ],
  };
}

/**
 * Computes comprehensive match statistics from an active or completed game state.
 * @param {Object} state
 * @param {number} [nowTimestamp]
 * @returns {Object}
 */
export function calculateMatchStatistics(state, nowTimestamp = Date.now()) {
  const scores = calculateScores(state.board);
  const endTime = state.completedAt || nowTimestamp;
  const durationMs = Math.max(0, endTime - (state.startedAt || endTime));
  const durationSeconds = Math.floor(durationMs / 1000);

  let maxFlipsInSingleMove = 0;
  let totalFlipsB = 0;
  let totalFlipsW = 0;
  let movesB = 0;
  let movesW = 0;

  for (const m of state.moveHistory) {
    if (m.capturedCount > maxFlipsInSingleMove) {
      maxFlipsInSingleMove = m.capturedCount;
    }
    if (m.player === BLACK) {
      movesB++;
      totalFlipsB += m.capturedCount;
    } else {
      movesW++;
      totalFlipsW += m.capturedCount;
    }
  }

  const corners = [
    [0, 0], [0, 7], [7, 0], [7, 7]
  ];
  let cornersB = 0;
  let cornersW = 0;
  for (const [r, c] of corners) {
    if (state.board[r][c] === BLACK) cornersB++;
    else if (state.board[r][c] === WHITE) cornersW++;
  }

  const endReasonLabels = {
    board_full: 'All 64 squares occupied',
    no_moves_both: 'Neither player had remaining legal moves',
    wipeout: 'All opponent discs were captured',
    timeout_B: 'Black ran out of time',
    timeout_W: 'White ran out of time',
    forfeit_B: 'Black forfeited the match',
    forfeit_W: 'White forfeited the match',
  };

  return {
    matchId: state.id,
    mode: state.mode,
    aiDifficulty: state.aiDifficulty,
    status: state.status,
    winner: state.winner,
    isDraw: state.winner === 'DRAW',
    blackScore: scores.B,
    whiteScore: scores.W,
    winningMargin: Math.abs(scores.B - scores.W),
    occupiedSquares: scores.occupied,
    emptySquares: scores.empty,
    totalMoves: state.moveHistory.length,
    movesByPlayer: { B: movesB, W: movesW },
    skippedTurns: { ...state.skippedTurns },
    totalDiscsCaptured: { B: totalFlipsB, W: totalFlipsW },
    maxFlipsInSingleMove,
    cornersCaptured: { B: cornersB, W: cornersW },
    durationMs,
    durationSeconds,
    formattedDuration: formatDuration(durationSeconds),
    endReason: state.endReason,
    endReasonText: endReasonLabels[state.endReason] || (state.status === 'completed' ? 'Match finished' : 'In progress'),
    players: state.players,
  };
}

/**
 * Formats seconds into MM:SS or HH:MM:SS.
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
