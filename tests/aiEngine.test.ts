import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNewGame,
  createEmptyBoard,
  applyMove,
  isValidMove,
} from '../src/engine/GameEngine';
import {
  selectAIMove,
  AIDifficulty,
} from '../src/ai/AIEngine';

test('AI Test 1: Every difficulty (Easy, Medium, Hard) selects a strictly legal move', () => {
  const difficulties: AIDifficulty[] = ['easy', 'medium', 'hard'];
  const game = createNewGame({ now: 1000 });

  for (const diff of difficulties) {
    const decision = selectAIMove(game.board, 'B', { difficulty: diff, seed: 42 });
    assert.notEqual(decision, null, `${diff} AI must return a move on starting board`);
    assert.equal(
      isValidMove(game.board, decision!.row, decision!.col, 'B'),
      true,
      `${diff} AI move (${decision!.row},${decision!.col}) must be legal`
    );
  }
});

test('AI Test 2: AI handles forced passes and game completion gracefully (returns null when no moves)', () => {
  const emptyBoard = createEmptyBoard();
  // Board where Black has no legal moves
  emptyBoard[0][0] = 'B';
  emptyBoard[0][1] = 'B';
  assert.equal(selectAIMove(emptyBoard, 'B', { difficulty: 'easy' }), null);
  assert.equal(selectAIMove(emptyBoard, 'B', { difficulty: 'medium' }), null);
  assert.equal(selectAIMove(emptyBoard, 'B', { difficulty: 'hard' }), null);
});

test('AI Test 3: Strategic strength differentiation — Medium & Hard prioritize corners over dangerous X-squares', () => {
  const board = createEmptyBoard();
  // Construct a board where White can either capture Corner (0,0) OR play dangerous X-square (1,1)
  // Corner (0,0) captures (0,1),(0,2) anchored by (0,3)='W'
  board[0][1] = 'B';
  board[0][2] = 'B';
  board[0][3] = 'W';
  // Also allow (1,1) X-square move capturing (2,2) anchored by (3,3)='W'
  board[2][2] = 'B';
  board[3][3] = 'W';

  const medMove = selectAIMove(board, 'W', { difficulty: 'medium', seed: 7 });
  const hardMove = selectAIMove(board, 'W', { difficulty: 'hard', seed: 7 });

  assert.notEqual(medMove, null);
  assert.notEqual(hardMove, null);
  assert.equal(medMove!.row, 0);
  assert.equal(medMove!.col, 0, 'Medium AI must seize corner (0,0)');
  assert.equal(hardMove!.row, 0);
  assert.equal(hardMove!.col, 0, 'Hard AI must seize corner (0,0)');
});

test('AI Test 4: Search remains responsive and deterministic with seed across a full AI-vs-AI match', () => {
  let state = createNewGame({ id: 'ai_match', now: 1000 });
  let step = 0;
  const startTime = Date.now();

  while (state.status === 'playing' && step < 70) {
    const difficulty: AIDifficulty = state.currentTurn === 'B' ? 'hard' : 'easy';
    const decision = selectAIMove(state.board, state.currentTurn, {
      difficulty,
      seed: 100 + step,
      depthOverride: difficulty === 'hard' ? 3 : 1,
    });
    assert.notEqual(decision, null, 'Active player in playing state must have a legal AI move');
    const res = applyMove(state, decision!.row, decision!.col, state.currentTurn, 1000 + step * 100);
    assert.equal(res.accepted, true);
    state = res.state;
    step++;
  }

  const elapsed = Date.now() - startTime;
  assert.equal(state.status, 'completed', 'Full AI vs AI game must reach completion');
  assert.ok(elapsed < 4000, `Full game should complete quickly (took ${elapsed}ms)`);
});
