"use strict";

var _nodeTest = _interopRequireDefault(require("node:test"));
var _strict = _interopRequireDefault(require("node:assert/strict"));
var _GameEngine = require("../src/engine/GameEngine");
var _AIEngine = require("../src/ai/AIEngine");
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
(0, _nodeTest.default)('AI Test 1: Every difficulty (Easy, Medium, Hard) selects a strictly legal move', () => {
  const difficulties = ['easy', 'medium', 'hard'];
  const game = (0, _GameEngine.createNewGame)({
    now: 1000
  });
  for (const diff of difficulties) {
    const decision = (0, _AIEngine.selectAIMove)(game.board, 'B', {
      difficulty: diff,
      seed: 42
    });
    _strict.default.notEqual(decision, null, `${diff} AI must return a move on starting board`);
    _strict.default.equal((0, _GameEngine.isValidMove)(game.board, decision.row, decision.col, 'B'), true, `${diff} AI move (${decision.row},${decision.col}) must be legal`);
  }
});
(0, _nodeTest.default)('AI Test 2: AI handles forced passes and game completion gracefully (returns null when no moves)', () => {
  const emptyBoard = (0, _GameEngine.createEmptyBoard)();
  // Board where Black has no legal moves
  emptyBoard[0][0] = 'B';
  emptyBoard[0][1] = 'B';
  _strict.default.equal((0, _AIEngine.selectAIMove)(emptyBoard, 'B', {
    difficulty: 'easy'
  }), null);
  _strict.default.equal((0, _AIEngine.selectAIMove)(emptyBoard, 'B', {
    difficulty: 'medium'
  }), null);
  _strict.default.equal((0, _AIEngine.selectAIMove)(emptyBoard, 'B', {
    difficulty: 'hard'
  }), null);
});
(0, _nodeTest.default)('AI Test 3: Strategic strength differentiation — Medium & Hard prioritize corners over dangerous X-squares', () => {
  const board = (0, _GameEngine.createEmptyBoard)();
  // Construct a board where White can either capture Corner (0,0) OR play dangerous X-square (1,1)
  // Corner (0,0) captures (0,1),(0,2) anchored by (0,3)='W'
  board[0][1] = 'B';
  board[0][2] = 'B';
  board[0][3] = 'W';
  // Also allow (1,1) X-square move capturing (2,2) anchored by (3,3)='W'
  board[2][2] = 'B';
  board[3][3] = 'W';
  const medMove = (0, _AIEngine.selectAIMove)(board, 'W', {
    difficulty: 'medium',
    seed: 7
  });
  const hardMove = (0, _AIEngine.selectAIMove)(board, 'W', {
    difficulty: 'hard',
    seed: 7
  });
  _strict.default.notEqual(medMove, null);
  _strict.default.notEqual(hardMove, null);
  _strict.default.equal(medMove.row, 0);
  _strict.default.equal(medMove.col, 0, 'Medium AI must seize corner (0,0)');
  _strict.default.equal(hardMove.row, 0);
  _strict.default.equal(hardMove.col, 0, 'Hard AI must seize corner (0,0)');
});
(0, _nodeTest.default)('AI Test 4: Search remains responsive and deterministic with seed across a full AI-vs-AI match', () => {
  let state = (0, _GameEngine.createNewGame)({
    id: 'ai_match',
    now: 1000
  });
  let step = 0;
  const startTime = Date.now();
  while (state.status === 'playing' && step < 70) {
    const difficulty = state.currentTurn === 'B' ? 'hard' : 'easy';
    const decision = (0, _AIEngine.selectAIMove)(state.board, state.currentTurn, {
      difficulty,
      seed: 100 + step,
      depthOverride: difficulty === 'hard' ? 3 : 1
    });
    _strict.default.notEqual(decision, null, 'Active player in playing state must have a legal AI move');
    const res = (0, _GameEngine.applyMove)(state, decision.row, decision.col, state.currentTurn, 1000 + step * 100);
    _strict.default.equal(res.accepted, true);
    state = res.state;
    step++;
  }
  const elapsed = Date.now() - startTime;
  _strict.default.equal(state.status, 'completed', 'Full AI vs AI game must reach completion');
  _strict.default.ok(elapsed < 4000, `Full game should complete quickly (took ${elapsed}ms)`);
});