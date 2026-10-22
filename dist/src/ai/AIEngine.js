"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.POSITIONAL_WEIGHTS = void 0;
exports.countFrontierDiscs = countFrontierDiscs;
exports.countStableEdgeDiscs = countStableEdgeDiscs;
exports.createSeededRandom = createSeededRandom;
exports.evaluateBoardHard = evaluateBoardHard;
exports.evaluateBoardMedium = evaluateBoardMedium;
exports.orderMoves = orderMoves;
exports.selectAIMove = selectAIMove;
var _GameEngine = require("../engine/GameEngine");
const POSITIONAL_WEIGHTS = [[120, -25, 20, 5, 5, 20, -25, 120], [-25, -45, -5, -5, -5, -5, -45, -25], [20, -5, 15, 3, 3, 15, -5, 20], [5, -5, 3, 3, 3, 3, -5, 5], [5, -5, 3, 3, 3, 3, -5, 5], [20, -5, 15, 3, 3, 15, -5, 20], [-25, -45, -5, -5, -5, -5, -45, -25], [120, -25, 20, 5, 5, 20, -25, 120]];
exports.POSITIONAL_WEIGHTS = POSITIONAL_WEIGHTS;
const CORNERS = [{
  r: 0,
  c: 0,
  adj: [[0, 1], [1, 0], [1, 1]]
}, {
  r: 0,
  c: 7,
  adj: [[0, 6], [1, 7], [1, 6]]
}, {
  r: 7,
  c: 0,
  adj: [[6, 0], [7, 1], [6, 1]]
}, {
  r: 7,
  c: 7,
  adj: [[6, 7], [7, 6], [6, 6]]
}];
function createSeededRandom(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ t >>> 15, 1 | t);
    r ^= r + Math.imul(r ^ r >>> 7, 61 | r);
    return ((r ^ r >>> 14) >>> 0) / 4294967296;
  };
}
function applyMoveOnBoardFast(board, move, player) {
  const next = (0, _GameEngine.cloneBoard)(board);
  next[move.row][move.col] = player;
  for (const pos of move.captured) {
    next[pos.row][pos.col] = player;
  }
  return next;
}
function countStableEdgeDiscs(board, player) {
  let stable = 0;
  const visited = Array.from({
    length: _GameEngine.BOARD_SIZE
  }, () => Array(_GameEngine.BOARD_SIZE).fill(false));
  const cornerCoords = [[0, 0, 1, 1], [0, 7, 1, -1], [7, 0, -1, 1], [7, 7, -1, -1]];
  for (const [cr, cc, dr, dc] of cornerCoords) {
    if (board[cr][cc] !== player) continue;
    for (let c = cc; c >= 0 && c < _GameEngine.BOARD_SIZE && board[cr][c] === player; c += dc) {
      if (!visited[cr][c]) {
        visited[cr][c] = true;
        stable++;
      }
    }
    for (let r = cr; r >= 0 && r < _GameEngine.BOARD_SIZE && board[r][cc] === player; r += dr) {
      if (!visited[r][cc]) {
        visited[r][cc] = true;
        stable++;
      }
    }
  }
  return stable;
}
function countFrontierDiscs(board) {
  let bFrontier = 0;
  let wFrontier = 0;
  for (let r = 0; r < _GameEngine.BOARD_SIZE; r++) {
    for (let c = 0; c < _GameEngine.BOARD_SIZE; c++) {
      const cell = board[r][c];
      if (!cell) continue;
      let isFrontier = false;
      for (const dir of _GameEngine.DIRECTIONS) {
        const nr = r + dir.row;
        const nc = c + dir.col;
        if ((0, _GameEngine.isInsideBoard)(nr, nc) && board[nr][nc] === null) {
          isFrontier = true;
          break;
        }
      }
      if (isFrontier) {
        if (cell === 'B') bFrontier++;else wFrontier++;
      }
    }
  }
  return {
    B: bFrontier,
    W: wFrontier
  };
}
function evaluateBoardMedium(board, aiPlayer) {
  const opponent = (0, _GameEngine.getOpponentColor)(aiPlayer);
  const scores = (0, _GameEngine.calculateScores)(board);
  const aiCount = aiPlayer === 'B' ? scores.black : scores.white;
  const oppCount = aiPlayer === 'B' ? scores.white : scores.black;
  const aiMoves = (0, _GameEngine.getLegalMoves)(board, aiPlayer).length;
  const oppMoves = (0, _GameEngine.getLegalMoves)(board, opponent).length;
  if (scores.empty === 0 || aiMoves === 0 && oppMoves === 0) {
    if (aiCount > oppCount) return 10000 + (aiCount - oppCount) * 100;
    if (aiCount < oppCount) return -10000 - (oppCount - aiCount) * 100;
    return 0;
  }
  let positional = 0;
  for (let r = 0; r < _GameEngine.BOARD_SIZE; r++) {
    for (let c = 0; c < _GameEngine.BOARD_SIZE; c++) {
      const cell = board[r][c];
      if (cell === aiPlayer) positional += POSITIONAL_WEIGHTS[r][c];else if (cell === opponent) positional -= POSITIONAL_WEIGHTS[r][c];
    }
  }
  const mobility = (aiMoves - oppMoves) * 12;
  const parity = (aiCount - oppCount) * (scores.empty < 14 ? 10 : 2);
  return positional + mobility + parity;
}
function evaluateBoardHard(board, aiPlayer) {
  const opponent = (0, _GameEngine.getOpponentColor)(aiPlayer);
  const scores = (0, _GameEngine.calculateScores)(board);
  const aiCount = aiPlayer === 'B' ? scores.black : scores.white;
  const oppCount = aiPlayer === 'B' ? scores.white : scores.black;
  const aiMoves = (0, _GameEngine.getLegalMoves)(board, aiPlayer).length;
  const oppMoves = (0, _GameEngine.getLegalMoves)(board, opponent).length;
  if (scores.empty === 0 || aiMoves === 0 && oppMoves === 0) {
    if (aiCount > oppCount) return 50000 + (aiCount - oppCount) * 200;
    if (aiCount < oppCount) return -50000 - (oppCount - aiCount) * 200;
    return 0;
  }
  const totalDiscs = 64 - scores.empty;
  const phase = totalDiscs <= 20 ? 'opening' : totalDiscs <= 48 ? 'midgame' : 'endgame';
  let positional = 0;
  for (let r = 0; r < _GameEngine.BOARD_SIZE; r++) {
    for (let c = 0; c < _GameEngine.BOARD_SIZE; c++) {
      const cell = board[r][c];
      if (!cell) continue;
      const w = POSITIONAL_WEIGHTS[r][c];
      if (cell === aiPlayer) positional += w;else positional -= w;
    }
  }
  let cornerControl = 0;
  for (const corner of CORNERS) {
    const owner = board[corner.r][corner.c];
    if (owner === aiPlayer) {
      cornerControl += 90;
      for (const [ar, ac] of corner.adj) {
        if (board[ar][ac] === aiPlayer) positional += 30;
      }
    } else if (owner === opponent) {
      cornerControl -= 90;
      for (const [ar, ac] of corner.adj) {
        if (board[ar][ac] === opponent) positional -= 30;
      }
    } else {
      for (const [ar, ac] of corner.adj) {
        const isDiagonalX = ar !== corner.r && ac !== corner.c;
        const penalty = isDiagonalX ? 55 : 25;
        if (board[ar][ac] === aiPlayer) cornerControl -= penalty;else if (board[ar][ac] === opponent) cornerControl += penalty;
      }
    }
  }
  const mobilityWeight = phase === 'opening' ? 22 : phase === 'midgame' ? 18 : 8;
  const mobility = (aiMoves - oppMoves) * mobilityWeight;
  const frontier = countFrontierDiscs(board);
  const aiFrontier = aiPlayer === 'B' ? frontier.B : frontier.W;
  const oppFrontier = aiPlayer === 'B' ? frontier.W : frontier.B;
  const frontierWeight = phase === 'endgame' ? 2 : 10;
  const frontierScore = (oppFrontier - aiFrontier) * frontierWeight;
  const aiStable = countStableEdgeDiscs(board, aiPlayer);
  const oppStable = countStableEdgeDiscs(board, opponent);
  const stabilityScore = (aiStable - oppStable) * 35;
  const parityWeight = phase === 'opening' ? -2 : phase === 'midgame' ? 4 : 28;
  const parityScore = (aiCount - oppCount) * parityWeight;
  return positional + cornerControl + mobility + frontierScore + stabilityScore + parityScore;
}
function orderMoves(moves) {
  return [...moves].sort((a, b) => {
    const weightA = POSITIONAL_WEIGHTS[a.row][a.col] + a.captured.length * 2;
    const weightB = POSITIONAL_WEIGHTS[b.row][b.col] + b.captured.length * 2;
    return weightB - weightA;
  });
}
function selectAIMove(board, aiPlayer, options = {
  difficulty: 'medium'
}) {
  const legalMoves = (0, _GameEngine.getLegalMoves)(board, aiPlayer);
  if (legalMoves.length === 0) {
    return null;
  }
  const rand = options.seed !== undefined ? createSeededRandom(options.seed) : Math.random;
  if (legalMoves.length === 1) {
    const only = legalMoves[0];
    return {
      row: only.row,
      col: only.col,
      capturedCount: only.captured.length,
      score: 0,
      nodesEvaluated: 1,
      depthReached: 1,
      difficulty: options.difficulty
    };
  }
  if (options.difficulty === 'easy') {
    const scored = legalMoves.map(m => {
      const basePos = POSITIONAL_WEIGHTS[m.row][m.col] * 0.15;
      const greedyCapture = m.captured.length * 4;
      const noise = (rand() - 0.5) * 45;
      return {
        move: m,
        score: basePos + greedyCapture + noise
      };
    });
    scored.sort((a, b) => b.score - a.score);
    const chosen = scored[0];
    return {
      row: chosen.move.row,
      col: chosen.move.col,
      capturedCount: chosen.move.captured.length,
      score: Math.round(chosen.score),
      nodesEvaluated: legalMoves.length,
      depthReached: 1,
      difficulty: 'easy'
    };
  }
  const scores = (0, _GameEngine.calculateScores)(board);
  const startTime = Date.now();
  const maxTimeMs = options.maxTimeMs ?? (options.difficulty === 'hard' ? 1200 : 400);
  let targetDepth = options.difficulty === 'medium' ? 3 : 5;
  if (options.difficulty === 'hard' && scores.empty <= 9) {
    targetDepth = Math.min(9, scores.empty);
  }
  if (options.depthOverride !== undefined) {
    targetDepth = options.depthOverride;
  }
  const evalFn = options.difficulty === 'hard' ? evaluateBoardHard : evaluateBoardMedium;
  let nodesEvaluated = 0;
  function alphaBeta(currentBoard, depth, alpha, beta, currentPlayer, passedLastTurn) {
    nodesEvaluated++;
    if (depth === 0 || nodesEvaluated > 250 && Date.now() - startTime > maxTimeMs) {
      return evalFn(currentBoard, aiPlayer);
    }
    const moves = (0, _GameEngine.getLegalMoves)(currentBoard, currentPlayer);
    if (moves.length === 0) {
      if (passedLastTurn) {
        return evalFn(currentBoard, aiPlayer);
      }
      return alphaBeta(currentBoard, depth - 1, alpha, beta, (0, _GameEngine.getOpponentColor)(currentPlayer), true);
    }
    const ordered = options.difficulty === 'hard' ? orderMoves(moves) : moves;
    const isMaximizing = currentPlayer === aiPlayer;
    if (isMaximizing) {
      let maxEval = -Infinity;
      for (const move of ordered) {
        const nextBoard = applyMoveOnBoardFast(currentBoard, move, currentPlayer);
        const evaluation = alphaBeta(nextBoard, depth - 1, alpha, beta, (0, _GameEngine.getOpponentColor)(currentPlayer), false);
        if (evaluation > maxEval) maxEval = evaluation;
        if (evaluation > alpha) alpha = evaluation;
        if (beta <= alpha) break;
      }
      return maxEval;
    } else {
      let minEval = Infinity;
      for (const move of ordered) {
        const nextBoard = applyMoveOnBoardFast(currentBoard, move, currentPlayer);
        const evaluation = alphaBeta(nextBoard, depth - 1, alpha, beta, (0, _GameEngine.getOpponentColor)(currentPlayer), false);
        if (evaluation < minEval) minEval = evaluation;
        if (evaluation < beta) beta = evaluation;
        if (beta <= alpha) break;
      }
      return minEval;
    }
  }
  const orderedRootMoves = options.difficulty === 'hard' ? orderMoves(legalMoves) : legalMoves;
  let bestMove = orderedRootMoves[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;
  for (const move of orderedRootMoves) {
    const nextBoard = applyMoveOnBoardFast(board, move, aiPlayer);
    const jitter = options.seed !== undefined ? (rand() - 0.5) * 0.01 : 0;
    const score = alphaBeta(nextBoard, targetDepth - 1, alpha, beta, (0, _GameEngine.getOpponentColor)(aiPlayer), false) + jitter;
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    if (score > alpha) {
      alpha = score;
    }
  }
  return {
    row: bestMove.row,
    col: bestMove.col,
    capturedCount: bestMove.captured.length,
    score: Math.round(bestScore),
    nodesEvaluated,
    depthReached: targetDepth,
    difficulty: options.difficulty
  };
}