import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialBoard,
  createEmptyBoard,
  cloneBoard,
  createNewGame,
  getCapturedDiscs,
  getLegalMoves,
  isValidMove,
  applyMove,
  passTurn,
  detectGameCompletion,
  calculateScores,
  calculateMatchStatistics,
  toAlgebraicNotation,
  BoardState,
} from '../src/engine/GameEngine';

test('1. Initial board configuration & standard starting state', () => {
  const game = createNewGame({ id: 'test_init', now: 1000 });
  assert.equal(game.board.length, 8);
  for (const row of game.board) {
    assert.equal(row.length, 8);
  }
  assert.equal(game.board[3][3], 'W');
  assert.equal(game.board[3][4], 'B');
  assert.equal(game.board[4][3], 'B');
  assert.equal(game.board[4][4], 'W');

  assert.equal(game.currentTurn, 'B', 'Black moves first');
  assert.equal(game.blackScore, 2);
  assert.equal(game.whiteScore, 2);
  assert.equal(game.emptyCount, 60);
  assert.equal(game.status, 'playing');

  const coords = game.legalMoves.map((m) => `${m.row},${m.col}`).sort();
  assert.deepEqual(coords, ['2,3', '3,2', '4,5', '5,4']);
  assert.equal(toAlgebraicNotation(2, 3), 'D3');
});

test('2. Legal moves and captures in all eight directions simultaneously', () => {
  const board: BoardState = createEmptyBoard();
  const dirs = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1],
  ];
  for (const [dr, dc] of dirs) {
    board[3 + dr][3 + dc] = 'W';
    board[3 + dr * 2][3 + dc * 2] = 'B';
  }

  const captured = getCapturedDiscs(board, 3, 3, 'B');
  assert.equal(captured.length, 8, 'Must capture opponent discs in all 8 directions');
  assert.equal(isValidMove(board, 3, 3, 'B'), true);

  const game = createNewGame({ board, startingPlayer: 'B', now: 1000 });
  const result = applyMove(game, 3, 3, 'B', 1500);
  assert.equal(result.accepted, true);
  assert.equal(result.state.blackScore, 17);
  assert.equal(result.state.whiteScore, 0);
});

test('3. Correct multi-disc capture and flipping behavior', () => {
  const board = createInitialBoard();
  const game0 = createNewGame({ board, now: 1000 });

  const move1 = applyMove(game0, 2, 3, 'B', 1100);
  assert.equal(move1.accepted, true);
  assert.equal(move1.state.board[2][3], 'B');
  assert.equal(move1.state.board[3][3], 'B');
  assert.equal(move1.state.blackScore, 4);
  assert.equal(move1.state.whiteScore, 1);
  assert.equal(move1.state.currentTurn, 'W');

  const move2 = applyMove(move1.state, 2, 2, 'W', 1200);
  assert.equal(move2.accepted, true);
  assert.equal(move2.state.board[2][2], 'W');
  assert.equal(move2.state.board[3][3], 'W');
  assert.equal(move2.state.blackScore, 3);
  assert.equal(move2.state.whiteScore, 3);
  assert.equal(move2.state.currentTurn, 'B');
});

test('4. Illegal move rejection without state mutation', () => {
  const game = createNewGame({ now: 1000 });
  const snapshotBefore = cloneBoard(game.board);

  const resOccupied = applyMove(game, 3, 3, 'B', 1100);
  assert.equal(resOccupied.accepted, false);
  assert.deepEqual(game.board, snapshotBefore);
  assert.equal(resOccupied.state, game);

  const resNoCapture = applyMove(game, 0, 0, 'B', 1100);
  assert.equal(resNoCapture.accepted, false);
  assert.deepEqual(game.board, snapshotBefore);

  const resWrongTurn = applyMove(game, 2, 3, 'W', 1100);
  assert.equal(resWrongTurn.accepted, false);
  assert.deepEqual(game.board, snapshotBefore);

  const resOOB = applyMove(game, -1, 8, 'B', 1100);
  assert.equal(resOOB.accepted, false);
  assert.deepEqual(game.board, snapshotBefore);
});

test('5. Automatic turn passing when opponent has no legal moves', () => {
  const board = createEmptyBoard();
  board[0][0] = 'B';
  board[0][1] = 'W';
  board[0][3] = 'B';
  board[0][4] = 'W';

  const game = createNewGame({ id: 'skip_test', board, startingPlayer: 'B', now: 1000 });
  const res = applyMove(game, 0, 2, 'B', 1500);

  assert.equal(res.accepted, true);
  assert.equal(res.state.status, 'playing');
  assert.equal(res.state.currentTurn, 'B', 'Turn must remain Black because White has no legal moves');
  assert.equal(res.state.skippedTurns.W, 1, 'White skipped turn count incremented');
  assert.equal(res.state.lastSkippedPlayer, 'W');

  const skipEvents = res.events.filter((e) => e.type === 'TURN_SKIPPED');
  assert.equal(skipEvents.length, 1);
  assert.equal(skipEvents[0].payload.skippedPlayer, 'W');
  assert.equal(skipEvents[0].payload.nextPlayer, 'B');
});

test('6. Game completion when neither player can move (without spurious pass alert)', () => {
  const board = createEmptyBoard();
  board[0][0] = 'B';
  board[0][1] = 'W';
  const game = createNewGame({ id: 'end_test', board, startingPlayer: 'B', now: 1000 });
  const res = applyMove(game, 0, 2, 'B', 2000);

  assert.equal(res.accepted, true);
  assert.equal(res.state.status, 'completed');
  assert.equal(res.state.endReason, 'no_legal_moves');
  assert.equal(res.state.winner, 'B');
  const skipEvents = res.events.filter((e) => e.type === 'TURN_SKIPPED');
  assert.equal(skipEvents.length, 0);
  const completeEvents = res.events.filter((e) => e.type === 'GAME_COMPLETED');
  assert.equal(completeEvents.length, 1);
});

test('7. Correct final score, full board completion, and draw detection', () => {
  const board = createEmptyBoard();
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

  const preScores = calculateScores(board);
  assert.equal(preScores.black, 30);
  assert.equal(preScores.white, 33);
  assert.equal(preScores.empty, 1);

  const game = createNewGame({ id: 'draw_test', board, startingPlayer: 'B', now: 1000 });
  const res = applyMove(game, 7, 7, 'B', 5000);
  assert.equal(res.accepted, true);
  assert.equal(res.state.status, 'completed');
  assert.equal(res.state.endReason, 'board_full');
  assert.equal(res.state.blackScore, 32);
  assert.equal(res.state.whiteScore, 32);
  assert.equal(res.state.winner, 'draw');

  const stats = calculateMatchStatistics(res.state);
  assert.equal(stats.winner, 'draw');
  assert.equal(stats.winningMargin, 0);
  assert.equal(stats.occupiedSquares, 64);
  assert.equal(stats.emptySquares, 0);
  assert.equal(stats.durationMs, 4000);
});

test('8. Accurate match statistics across multiple moves and captures', () => {
  let state = createNewGame({ id: 'stats_test', now: 10000 });
  state = applyMove(state, 2, 3, 'B', 11000).state; // B: 4, W: 1
  state = applyMove(state, 2, 2, 'W', 12500).state; // B: 3, W: 3
  state = applyMove(state, 2, 1, 'B', 15000).state; // B: 5, W: 2

  const stats = calculateMatchStatistics(state, 16000);
  assert.equal(stats.totalMoves, 3);
  assert.equal(stats.occupiedSquares, 7);
  assert.equal(stats.emptySquares, 57);
  assert.equal(stats.blackScore, 5);
  assert.equal(stats.whiteScore, 2);
  assert.equal(stats.winningMargin, 3);
  assert.equal(stats.durationMs, 6000);
  assert.equal(stats.totalCapturesBlack, 2);
  assert.equal(stats.totalCapturesWhite, 1);
});
