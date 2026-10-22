"use strict";

var _nodeTest = _interopRequireDefault(require("node:test"));
var _strict = _interopRequireDefault(require("node:assert/strict"));
var _GameEngine = require("../src/engine/GameEngine");
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
(0, _nodeTest.default)('1. Initial board configuration & standard starting state', () => {
  const game = (0, _GameEngine.createNewGame)({
    id: 'test_init',
    now: 1000
  });
  _strict.default.equal(game.board.length, 8);
  for (const row of game.board) {
    _strict.default.equal(row.length, 8);
  }
  _strict.default.equal(game.board[3][3], 'W');
  _strict.default.equal(game.board[3][4], 'B');
  _strict.default.equal(game.board[4][3], 'B');
  _strict.default.equal(game.board[4][4], 'W');
  _strict.default.equal(game.currentTurn, 'B', 'Black moves first');
  _strict.default.equal(game.blackScore, 2);
  _strict.default.equal(game.whiteScore, 2);
  _strict.default.equal(game.emptyCount, 60);
  _strict.default.equal(game.status, 'playing');
  const coords = game.legalMoves.map(m => `${m.row},${m.col}`).sort();
  _strict.default.deepEqual(coords, ['2,3', '3,2', '4,5', '5,4']);
  _strict.default.equal((0, _GameEngine.toAlgebraicNotation)(2, 3), 'D3');
});
(0, _nodeTest.default)('2. Legal moves and captures in all eight directions simultaneously', () => {
  const board = (0, _GameEngine.createEmptyBoard)();
  const dirs = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  for (const [dr, dc] of dirs) {
    board[3 + dr][3 + dc] = 'W';
    board[3 + dr * 2][3 + dc * 2] = 'B';
  }
  const captured = (0, _GameEngine.getCapturedDiscs)(board, 3, 3, 'B');
  _strict.default.equal(captured.length, 8, 'Must capture opponent discs in all 8 directions');
  _strict.default.equal((0, _GameEngine.isValidMove)(board, 3, 3, 'B'), true);
  const game = (0, _GameEngine.createNewGame)({
    board,
    startingPlayer: 'B',
    now: 1000
  });
  const result = (0, _GameEngine.applyMove)(game, 3, 3, 'B', 1500);
  _strict.default.equal(result.accepted, true);
  _strict.default.equal(result.state.blackScore, 17);
  _strict.default.equal(result.state.whiteScore, 0);
});
(0, _nodeTest.default)('3. Correct multi-disc capture and flipping behavior', () => {
  const board = (0, _GameEngine.createInitialBoard)();
  const game0 = (0, _GameEngine.createNewGame)({
    board,
    now: 1000
  });
  const move1 = (0, _GameEngine.applyMove)(game0, 2, 3, 'B', 1100);
  _strict.default.equal(move1.accepted, true);
  _strict.default.equal(move1.state.board[2][3], 'B');
  _strict.default.equal(move1.state.board[3][3], 'B');
  _strict.default.equal(move1.state.blackScore, 4);
  _strict.default.equal(move1.state.whiteScore, 1);
  _strict.default.equal(move1.state.currentTurn, 'W');
  const move2 = (0, _GameEngine.applyMove)(move1.state, 2, 2, 'W', 1200);
  _strict.default.equal(move2.accepted, true);
  _strict.default.equal(move2.state.board[2][2], 'W');
  _strict.default.equal(move2.state.board[3][3], 'W');
  _strict.default.equal(move2.state.blackScore, 3);
  _strict.default.equal(move2.state.whiteScore, 3);
  _strict.default.equal(move2.state.currentTurn, 'B');
});
(0, _nodeTest.default)('4. Illegal move rejection without state mutation', () => {
  const game = (0, _GameEngine.createNewGame)({
    now: 1000
  });
  const snapshotBefore = (0, _GameEngine.cloneBoard)(game.board);
  const resOccupied = (0, _GameEngine.applyMove)(game, 3, 3, 'B', 1100);
  _strict.default.equal(resOccupied.accepted, false);
  _strict.default.deepEqual(game.board, snapshotBefore);
  _strict.default.equal(resOccupied.state, game);
  const resNoCapture = (0, _GameEngine.applyMove)(game, 0, 0, 'B', 1100);
  _strict.default.equal(resNoCapture.accepted, false);
  _strict.default.deepEqual(game.board, snapshotBefore);
  const resWrongTurn = (0, _GameEngine.applyMove)(game, 2, 3, 'W', 1100);
  _strict.default.equal(resWrongTurn.accepted, false);
  _strict.default.deepEqual(game.board, snapshotBefore);
  const resOOB = (0, _GameEngine.applyMove)(game, -1, 8, 'B', 1100);
  _strict.default.equal(resOOB.accepted, false);
  _strict.default.deepEqual(game.board, snapshotBefore);
});
(0, _nodeTest.default)('5. Automatic turn passing when opponent has no legal moves', () => {
  const board = (0, _GameEngine.createEmptyBoard)();
  board[0][0] = 'B';
  board[0][1] = 'W';
  board[0][3] = 'B';
  board[0][4] = 'W';
  const game = (0, _GameEngine.createNewGame)({
    id: 'skip_test',
    board,
    startingPlayer: 'B',
    now: 1000
  });
  const res = (0, _GameEngine.applyMove)(game, 0, 2, 'B', 1500);
  _strict.default.equal(res.accepted, true);
  _strict.default.equal(res.state.status, 'playing');
  _strict.default.equal(res.state.currentTurn, 'B', 'Turn must remain Black because White has no legal moves');
  _strict.default.equal(res.state.skippedTurns.W, 1, 'White skipped turn count incremented');
  _strict.default.equal(res.state.lastSkippedPlayer, 'W');
  const skipEvents = res.events.filter(e => e.type === 'TURN_SKIPPED');
  _strict.default.equal(skipEvents.length, 1);
  _strict.default.equal(skipEvents[0].payload.skippedPlayer, 'W');
  _strict.default.equal(skipEvents[0].payload.nextPlayer, 'B');
});
(0, _nodeTest.default)('6. Game completion when neither player can move (without spurious pass alert)', () => {
  const board = (0, _GameEngine.createEmptyBoard)();
  board[0][0] = 'B';
  board[0][1] = 'W';
  const game = (0, _GameEngine.createNewGame)({
    id: 'end_test',
    board,
    startingPlayer: 'B',
    now: 1000
  });
  const res = (0, _GameEngine.applyMove)(game, 0, 2, 'B', 2000);
  _strict.default.equal(res.accepted, true);
  _strict.default.equal(res.state.status, 'completed');
  _strict.default.equal(res.state.endReason, 'no_legal_moves');
  _strict.default.equal(res.state.winner, 'B');
  const skipEvents = res.events.filter(e => e.type === 'TURN_SKIPPED');
  _strict.default.equal(skipEvents.length, 0);
  const completeEvents = res.events.filter(e => e.type === 'GAME_COMPLETED');
  _strict.default.equal(completeEvents.length, 1);
});
(0, _nodeTest.default)('7. Correct final score, full board completion, and draw detection', () => {
  const board = (0, _GameEngine.createEmptyBoard)();
  // Construct a clean 63-disc board where placing Black at (7,7) ONLY flips (7,6) horizontally:
  // Make all of col 7 White so vertical from (7,7) has no Black anchor,
  // and make diagonal (0,0)..(6,6) all White so NW diagonal has no Black anchor!
  // Then adjust remaining squares to have exactly 30 Black and 33 White before the move.
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      board[r][c] = 'W';
    }
  }
  board[7][7] = null;
  board[7][6] = 'W';
  board[7][5] = 'B'; // Horizontal anchor for (7,7) capturing only (7,6)

  // Now we need 29 more 'B' discs on squares that are NOT on col 7 and NOT on main diagonal (r === c)
  let addedB = 0;
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      if (r === c) continue; // Keep main diagonal 'W' so NW from (7,7) has no 'B' anchor
      if (addedB < 29) {
        board[r][c] = 'B';
        addedB++;
      }
    }
  }
  const preScores = (0, _GameEngine.calculateScores)(board);
  _strict.default.equal(preScores.black, 30);
  _strict.default.equal(preScores.white, 33);
  _strict.default.equal(preScores.empty, 1);
  const game = (0, _GameEngine.createNewGame)({
    id: 'draw_test',
    board,
    startingPlayer: 'B',
    now: 1000
  });
  const res = (0, _GameEngine.applyMove)(game, 7, 7, 'B', 5000);
  _strict.default.equal(res.accepted, true);
  _strict.default.equal(res.state.status, 'completed');
  _strict.default.equal(res.state.endReason, 'board_full');
  _strict.default.equal(res.state.blackScore, 32);
  _strict.default.equal(res.state.whiteScore, 32);
  _strict.default.equal(res.state.winner, 'draw');
  const stats = (0, _GameEngine.calculateMatchStatistics)(res.state);
  _strict.default.equal(stats.winner, 'draw');
  _strict.default.equal(stats.winningMargin, 0);
  _strict.default.equal(stats.occupiedSquares, 64);
  _strict.default.equal(stats.emptySquares, 0);
  _strict.default.equal(stats.durationMs, 4000);
});
(0, _nodeTest.default)('8. Accurate match statistics across multiple moves and captures', () => {
  let state = (0, _GameEngine.createNewGame)({
    id: 'stats_test',
    now: 10000
  });
  state = (0, _GameEngine.applyMove)(state, 2, 3, 'B', 11000).state; // B: 4, W: 1
  state = (0, _GameEngine.applyMove)(state, 2, 2, 'W', 12500).state; // B: 3, W: 3
  state = (0, _GameEngine.applyMove)(state, 2, 1, 'B', 15000).state; // B: 5, W: 2

  const stats = (0, _GameEngine.calculateMatchStatistics)(state, 16000);
  _strict.default.equal(stats.totalMoves, 3);
  _strict.default.equal(stats.occupiedSquares, 7);
  _strict.default.equal(stats.emptySquares, 57);
  _strict.default.equal(stats.blackScore, 5);
  _strict.default.equal(stats.whiteScore, 2);
  _strict.default.equal(stats.winningMargin, 3);
  _strict.default.equal(stats.durationMs, 6000);
  _strict.default.equal(stats.totalCapturesBlack, 2);
  _strict.default.equal(stats.totalCapturesWhite, 1);
});