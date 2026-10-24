/**
 * FLIX REVERSI — AI Opponent Engine (Easy, Medium, Hard)
 * Uses legal moves from the shared GameEngine.
 * Supports deterministic seed for automated testing and Web Worker execution.
 */

import {
  BLACK,
  WHITE,
  EMPTY,
  BOARD_SIZE,
  DIRECTIONS,
  getOpponent,
  calculateLegalMoves,
  calculateScores,
  cloneBoard,
  isInBounds,
} from '../engine/GameEngine.mjs';

/**
 * Classic positional weight matrix for 8x8 Reversi.
 * Corners (+120) are high value; X-squares (-40) and C-squares (-20) adjacent to empty corners are penalized.
 */
export const POSITIONAL_WEIGHTS = Object.freeze([
  [120, -20,  20,   5,   5,  20, -20, 120],
  [-20, -40,  -5,  -5,  -5,  -5, -40, -20],
  [ 20,  -5,  15,   3,   3,  15,  -5,  20],
  [  5,  -5,   3,   3,   3,   3,  -5,   5],
  [  5,  -5,   3,   3,   3,   3,  -5,   5],
  [ 20,  -5,  15,   3,   3,  15,  -5,  20],
  [-20, -40,  -5,  -5,  -5,  -5, -40, -20],
  [120, -20,  20,   5,   5,  20, -20, 120],
]);

const CORNERS = Object.freeze([
  [0, 0], [0, 7], [7, 0], [7, 7],
]);

const CORNER_ADJACENT_MAP = Object.freeze([
  { corner: [0, 0], adj: [[0, 1], [1, 0], [1, 1]] },
  { corner: [0, 7], adj: [[0, 6], [1, 7], [1, 6]] },
  { corner: [7, 0], adj: [[6, 0], [7, 1], [6, 1]] },
  { corner: [7, 7], adj: [[6, 7], [7, 6], [6, 6]] },
]);

/**
 * Simple deterministic Mulberry32 PRNG for reproducible AI testing.
 * @param {number} seed
 * @returns {() => number}
 */
export function createSeededRandom(seed = 1337) {
  let a = seed >>> 0;
  return function nextRandom() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fast board transition helper for search tree nodes.
 * @param {Array<Array<'B'|'W'|null>>} board
 * @param {Object} move
 * @param {'B'|'W'} color
 * @returns {Array<Array<'B'|'W'|null>>}
 */
function applyMoveFast(board, move, color) {
  const next = cloneBoard(board);
  next[move.row][move.col] = color;
  for (const flip of move.flips) {
    next[flip.row][flip.col] = color;
  }
  return next;
}

/**
 * Estimates stable discs anchored to captured corners along edges.
 * @param {Array<Array<'B'|'W'|null>>} board
 * @param {'B'|'W'} color
 * @returns {number}
 */
export function countStableEdgeDiscs(board, color) {
  let stable = 0;
  const visited = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(false));

  const edgeDirections = [
    { corner: [0, 0], dirs: [[0, 1], [1, 0]] },
    { corner: [0, 7], dirs: [[0, -1], [1, 0]] },
    { corner: [7, 0], dirs: [[0, 1], [-1, 0]] },
    { corner: [7, 7], dirs: [[0, -1], [-1, 0]] },
  ];

  for (const { corner, dirs } of edgeDirections) {
    const [cr, cc] = corner;
    if (board[cr][cc] !== color) continue;
    if (!visited[cr][cc]) {
      visited[cr][cc] = true;
      stable += 2; // Corner anchor bonus
    }
    for (const [dr, dc] of dirs) {
      let r = cr + dr;
      let c = cc + dc;
      while (isInBounds(r, c) && board[r][c] === color) {
        if (!visited[r][c]) {
          visited[r][c] = true;
          stable += 1;
        }
        r += dr;
        c += dc;
      }
    }
  }
  return stable;
}

/**
 * Counts frontier discs (discs adjacent to at least one empty square).
 * Having fewer frontier discs is advantageous in early/mid game.
 * @param {Array<Array<'B'|'W'|null>>} board
 * @param {'B'|'W'} color
 * @returns {number}
 */
export function countFrontierDiscs(board, color) {
  let frontier = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== color) continue;
      for (const [dr, dc] of DIRECTIONS) {
        const nr = r + dr;
        const nc = c + dc;
        if (isInBounds(nr, nc) && board[nr][nc] === EMPTY) {
          frontier++;
          break;
        }
      }
    }
  }
  return frontier;
}

/**
 * Evaluates board for `aiColor` according to `difficulty` ('medium' | 'hard').
 * @param {Array<Array<'B'|'W'|null>>} board
 * @param {'B'|'W'} aiColor
 * @param {'medium'|'hard'} difficulty
 * @returns {number}
 */
export function evaluateBoard(board, aiColor, difficulty = 'hard') {
  const oppColor = getOpponent(aiColor);
  const scores = calculateScores(board);
  const myDiscs = scores[aiColor];
  const oppDiscs = scores[oppColor];

  const myMoves = calculateLegalMoves(board, aiColor);
  const oppMoves = calculateLegalMoves(board, oppColor);

  // Terminal board check
  if (scores.empty === 0 || (myMoves.length === 0 && oppMoves.length === 0)) {
    if (myDiscs > oppDiscs) return 100000 + (myDiscs - oppDiscs) * 100;
    if (oppDiscs > myDiscs) return -100000 - (oppDiscs - myDiscs) * 100;
    return 0;
  }

  // Dynamic positional score adjusting for occupied corners
  let positional = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = board[r][c];
      if (cell === EMPTY) continue;
      const w = POSITIONAL_WEIGHTS[r][c];
      if (cell === aiColor) positional += w;
      else positional -= w;
    }
  }

  // Dynamic corner-adjacency adjustment: once a corner is occupied, its adjacent squares are no longer dangerous
  for (const { corner, adj } of CORNER_ADJACENT_MAP) {
    const [cr, cc] = corner;
    const cornerOwner = board[cr][cc];
    if (cornerOwner !== EMPTY) {
      for (const [ar, ac] of adj) {
        if (board[ar][ac] === cornerOwner) {
          const bonus = Math.abs(POSITIONAL_WEIGHTS[ar][ac]) + 12;
          positional += cornerOwner === aiColor ? bonus : -bonus;
        }
      }
    }
  }

  // Corner control
  let myCorners = 0;
  let oppCorners = 0;
  for (const [cr, cc] of CORNERS) {
    if (board[cr][cc] === aiColor) myCorners++;
    else if (board[cr][cc] === oppColor) oppCorners++;
  }
  const cornerScore = 320 * (myCorners - oppCorners);

  // Mobility
  const mobilityScore =
    myMoves.length + oppMoves.length > 0
      ? (100 * (myMoves.length - oppMoves.length)) / (myMoves.length + oppMoves.length + 1)
      : 0;

  if (difficulty === 'medium') {
    return positional + cornerScore * 0.8 + mobilityScore * 1.2 + (myDiscs - oppDiscs) * 0.5;
  }

  // Hard difficulty: game-phase-dependent evaluation with frontier discs, stability, parity
  const occupied = scores.occupied;
  const myFrontier = countFrontierDiscs(board, aiColor);
  const oppFrontier = countFrontierDiscs(board, oppColor);
  const frontierScore = -14 * (myFrontier - oppFrontier);

  const myStable = countStableEdgeDiscs(board, aiColor);
  const oppStable = countStableEdgeDiscs(board, oppColor);
  const stabilityScore = 65 * (myStable - oppStable);

  const discParity = (100 * (myDiscs - oppDiscs)) / Math.max(1, myDiscs + oppDiscs);

  if (occupied <= 20) {
    // Opening phase: prioritize mobility, minimal frontier, and positional safety
    return (
      positional * 1.1 +
      cornerScore +
      mobilityScore * 2.4 +
      frontierScore * 1.5 +
      stabilityScore * 0.8 -
      discParity * 0.25
    );
  } else if (occupied <= 50) {
    // Midgame phase: balance mobility, stability, corners, and frontier
    return (
      positional * 1.0 +
      cornerScore * 1.3 +
      mobilityScore * 2.0 +
      frontierScore * 1.1 +
      stabilityScore * 1.4 +
      discParity * 0.2
    );
  } else {
    // Late game: disc count, stability, and corners dominate
    return (
      positional * 0.6 +
      cornerScore * 1.4 +
      mobilityScore * 1.0 +
      stabilityScore * 1.8 +
      discParity * 2.2
    );
  }
}

/**
 * Orders moves to maximize Alpha-Beta pruning cutoffs.
 * @param {Array<Object>} moves
 * @param {Array<Array<'B'|'W'|null>>} board
 * @returns {Array<Object>}
 */
function orderMoves(moves, board) {
  return [...moves].sort((a, b) => {
    const scoreA = POSITIONAL_WEIGHTS[a.row][a.col] * 3 + a.flips.length * 2;
    const scoreB = POSITIONAL_WEIGHTS[b.row][b.col] * 3 + b.flips.length * 2;
    return scoreB - scoreA;
  });
}

/**
 * Minimax with Alpha-Beta pruning.
 */
function minimaxAlphaBeta(board, depth, alpha, beta, currentTurn, aiColor, difficulty, deadlineMs, stats) {
  stats.nodesVisited++;

  if (deadlineMs && Date.now() > deadlineMs && depth > 1) {
    return { score: evaluateBoard(board, aiColor, difficulty), move: null, aborted: true };
  }

  const scores = calculateScores(board);
  if (depth <= 0 || scores.empty === 0) {
    return { score: evaluateBoard(board, aiColor, difficulty), move: null, aborted: false };
  }

  const legalMoves = calculateLegalMoves(board, currentTurn);
  const nextTurnColor = getOpponent(currentTurn);

  if (legalMoves.length === 0) {
    const otherMoves = calculateLegalMoves(board, nextTurnColor);
    if (otherMoves.length === 0) {
      // Game over node
      return { score: evaluateBoard(board, aiColor, difficulty), move: null, aborted: false };
    }
    // Pass turn without decrementing depth excessively
    return minimaxAlphaBeta(board, depth - 1, alpha, beta, nextTurnColor, aiColor, difficulty, deadlineMs, stats);
  }

  const ordered = difficulty === 'hard' ? orderMoves(legalMoves, board) : legalMoves;
  const isMaximizing = currentTurn === aiColor;
  let bestMove = ordered[0];

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const move of ordered) {
      const childBoard = applyMoveFast(board, move, currentTurn);
      const res = minimaxAlphaBeta(
        childBoard,
        depth - 1,
        alpha,
        beta,
        nextTurnColor,
        aiColor,
        difficulty,
        deadlineMs,
        stats
      );
      if (res.score > maxEval) {
        maxEval = res.score;
        bestMove = move;
      }
      alpha = Math.max(alpha, res.score);
      if (beta <= alpha) break;
    }
    return { score: maxEval, move: bestMove, aborted: false };
  } else {
    let minEval = Infinity;
    for (const move of ordered) {
      const childBoard = applyMoveFast(board, move, currentTurn);
      const res = minimaxAlphaBeta(
        childBoard,
        depth - 1,
        alpha,
        beta,
        nextTurnColor,
        aiColor,
        difficulty,
        deadlineMs,
        stats
      );
      if (res.score < minEval) {
        minEval = res.score;
        bestMove = move;
      }
      beta = Math.min(beta, res.score);
      if (beta <= alpha) break;
    }
    return { score: minEval, move: bestMove, aborted: false };
  }
}

/**
 * Selects a legal move for the AI based on difficulty ('easy' | 'medium' | 'hard').
 * Never generates illegal moves. Returns null if no legal moves exist.
 *
 * @param {Array<Array<'B'|'W'|null>>} board
 * @param {'B'|'W'} aiColor
 * @param {'easy'|'medium'|'hard'} [difficulty='medium']
 * @param {Object} [options]
 * @param {number} [options.seed] - optional deterministic seed for testing
 * @param {number} [options.maxTimeMs] - time budget in ms
 * @returns {{
 *   row: number,
 *   col: number,
 *   notation: string,
 *   flips: Array,
 *   difficulty: string,
 *   evaluation: number,
 *   depthReached: number,
 *   nodesVisited: number
 * } | null}
 */
export function selectAIMove(board, aiColor, difficulty = 'medium', options = {}) {
  const legalMoves = calculateLegalMoves(board, aiColor);
  if (legalMoves.length === 0) {
    return null;
  }

  const rng = options.seed !== undefined ? createSeededRandom(options.seed) : Math.random;

  // Single forced move shortcut
  if (legalMoves.length === 1) {
    return {
      ...legalMoves[0],
      difficulty,
      evaluation: 0,
      depthReached: 1,
      nodesVisited: 1,
    };
  }

  // EASY: Randomized legal moves with basic positional preference and intentionally weaker strategic vision
  if (difficulty === 'easy') {
    const scored = legalMoves.map((move) => {
      // Easy AI likes immediate captures and mild positional weights with high noise,
      // and occasionally overlooks X-square danger.
      const basePos = POSITIONAL_WEIGHTS[move.row][move.col] * 0.25;
      const greedyFlips = move.flips.length * 4;
      const noise = (rng() - 0.5) * 45;
      return {
        move,
        score: basePos + greedyFlips + noise,
      };
    });
    scored.sort((a, b) => b.score - a.score);
    const chosen = scored[0];
    return {
      ...chosen.move,
      difficulty: 'easy',
      evaluation: Math.round(chosen.score),
      depthReached: 1,
      nodesVisited: legalMoves.length,
    };
  }

  // MEDIUM: Limited-depth minimax (depth 3) with alpha-beta pruning, corner preference, and mobility
  if (difficulty === 'medium') {
    const stats = { nodesVisited: 0 };
    const depth = 3;
    const deadlineMs = Date.now() + (options.maxTimeMs || 600);
    const result = minimaxAlphaBeta(
      board,
      depth,
      -Infinity,
      Infinity,
      aiColor,
      aiColor,
      'medium',
      deadlineMs,
      stats
    );
    const selected = result.move || legalMoves[0];
    return {
      ...selected,
      difficulty: 'medium',
      evaluation: Math.round(result.score),
      depthReached: depth,
      nodesVisited: stats.nodesVisited,
    };
  }

  // HARD: Deeper iterative-deepening minimax with alpha-beta pruning, move ordering,
  // frontier penalties, edge stability, and endgame search extension when <= 10 empty squares remain.
  const scores = calculateScores(board);
  const isEndgame = scores.empty <= 10;
  const targetDepth = isEndgame ? Math.min(scores.empty, 8) : 5;
  const maxTimeMs = options.maxTimeMs || 1100;
  const deadlineMs = Date.now() + maxTimeMs;
  const stats = { nodesVisited: 0 };

  let bestMove = orderMoves(legalMoves, board)[0];
  let bestScore = -Infinity;
  let depthReached = 1;

  for (let d = 2; d <= targetDepth; d++) {
    const res = minimaxAlphaBeta(
      board,
      d,
      -Infinity,
      Infinity,
      aiColor,
      aiColor,
      'hard',
      deadlineMs,
      stats
    );
    if (!res.aborted && res.move) {
      bestMove = res.move;
      bestScore = res.score;
      depthReached = d;
    }
    if (Date.now() > deadlineMs) break;
  }

  return {
    ...bestMove,
    difficulty: 'hard',
    evaluation: Math.round(bestScore),
    depthReached,
    nodesVisited: stats.nodesVisited,
  };
}
