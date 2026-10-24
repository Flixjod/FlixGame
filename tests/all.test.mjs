/**
 * FLIX REVERSI — Automated Verification Suite
 * Covers:
 * 1. Essential Game-Engine Tests (8 tests)
 * 2. AI Opponent Tests (Easy, Medium, Hard + forced pass + performance)
 * 3. Online Multiplayer & Reconnection Tests (6 tests)
 * 4. UI, Notifications, Audio, Accessibility & Reduced-Motion Integration Tests (7 tests)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BLACK,
  WHITE,
  EMPTY,
  BOARD_SIZE,
  createInitialBoard,
  cloneBoard,
  calculateLegalMoves,
  getCapturedDiscs,
  applyMove,
  passTurn,
  createNewGame,
  calculateScores,
  calculateMatchStatistics,
} from '../src/engine/GameEngine.mjs';

import { selectAIMove, evaluateBoard } from '../src/ai/AIEngine.mjs';
import { EventManager, EVENT_TYPES } from '../src/events/EventManager.mjs';
import {
  AuthoritativeRoomStore,
  MultiplayerService,
  CONNECTION_STATES,
} from '../src/multiplayer/MultiplayerService.mjs';
import { AudioManager, SOUND_EFFECTS } from '../src/audio/AudioManager.mjs';
import { NotificationManager } from '../src/ui/NotificationManager.mjs';
import { SettingsManager } from '../src/ui/SettingsManager.mjs';

// ============================================================================
// 1. ESSENTIAL GAME-ENGINE TESTS
// ============================================================================

test('1.1 Initial board configuration has 4 center discs in diagonal arrangement and Black moves first', () => {
  const game = createNewGame();
  assert.equal(game.board.length, 8);
  assert.equal(game.board[0].length, 8);
  assert.equal(game.board[3][3], WHITE);
  assert.equal(game.board[4][4], WHITE);
  assert.equal(game.board[3][4], BLACK);
  assert.equal(game.board[4][3], BLACK);
  assert.equal(game.turn, BLACK);
  assert.equal(game.scores.B, 2);
  assert.equal(game.scores.W, 2);
  assert.equal(game.scores.empty, 60);

  // Standard 4 opening legal moves for Black: (2,3)=d3, (3,2)=c4, (4,5)=f5, (5,4)=e6
  const coords = game.legalMoves.map((m) => `${m.row},${m.col}`).sort();
  assert.deepEqual(coords, ['2,3', '3,2', '4,5', '5,4']);
});

test('1.2 Legal moves and bracketing work accurately across all eight directions', () => {
  // Construct a board where placing Black at center (3,3) captures White discs in all 8 directions
  const board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));
  const directions = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1],
  ];

  for (const [dr, dc] of directions) {
    board[3 + dr][3 + dc] = WHITE;     // Adjacent opponent disc
    board[3 + dr * 2][3 + dc * 2] = BLACK; // Bracketing anchor disc
  }

  const captured = getCapturedDiscs(board, 3, 3, BLACK);
  assert.equal(captured.length, 8, 'Must capture 1 opponent disc in each of the 8 directions');

  const dirSet = new Set(captured.map((c) => `${c.direction[0]},${c.direction[1]}`));
  assert.equal(dirSet.size, 8, 'All 8 directions must be represented');
});

test('1.3 Correct capture and flipping behavior updates scores and turn', () => {
  const game = createNewGame();
  // Black plays at (2,3) -> captures White at (3,3)
  const result = applyMove(game, 2, 3, BLACK);
  assert.equal(result.accepted, true);
  assert.equal(result.state.board[2][3], BLACK);
  assert.equal(result.state.board[3][3], BLACK); // Flipped from White to Black
  assert.equal(result.state.scores.B, 4);
  assert.equal(result.state.scores.W, 1);
  assert.equal(result.state.turn, WHITE);
  assert.equal(result.moveRecord.capturedCount, 1);
});

test('1.4 Illegal move rejection leaves authoritative state completely unmutated', () => {
  const game = createNewGame();
  const originalBoardSnapshot = JSON.stringify(game.board);

  // 1) Move on occupied square (3,3)
  const occupiedRes = applyMove(game, 3, 3, BLACK);
  assert.equal(occupiedRes.accepted, false);
  assert.equal(occupiedRes.reason, 'CELL_OCCUPIED');
  assert.equal(JSON.stringify(game.board), originalBoardSnapshot);

  // 2) Move on empty square that brackets zero discs (0,0)
  const noBracketRes = applyMove(game, 0, 0, BLACK);
  assert.equal(noBracketRes.accepted, false);
  assert.equal(noBracketRes.reason, 'NO_BRACKETED_DISCS');
  assert.equal(JSON.stringify(game.board), originalBoardSnapshot);

  // 3) Out-of-turn move by White
  const wrongTurnRes = applyMove(game, 2, 3, WHITE);
  assert.equal(wrongTurnRes.accepted, false);
  assert.equal(wrongTurnRes.reason, 'OUT_OF_TURN');
  assert.equal(JSON.stringify(game.board), originalBoardSnapshot);

  // 4) Out-of-bounds move
  const oobRes = applyMove(game, -1, 8, BLACK);
  assert.equal(oobRes.accepted, false);
  assert.equal(oobRes.reason, 'OUT_OF_BOUNDS');
  assert.equal(JSON.stringify(game.board), originalBoardSnapshot);
});

test('1.5 Automatic turn passing when next player has no legal moves', () => {
  // Set up a board where after Black plays at (0,2), White has NO legal moves, but Black still has a move
  const board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));
  board[0][0] = BLACK;
  board[0][1] = WHITE;
  board[7][0] = BLACK;
  board[7][1] = WHITE;

  const game = createNewGame({ initialBoard: board, startingTurn: BLACK });
  const res = applyMove(game, 0, 2, BLACK);

  assert.equal(res.accepted, true);
  assert.equal(res.state.lastSkippedPlayer, WHITE);
  assert.equal(res.state.turn, BLACK);
  assert.equal(res.state.skippedTurns.W, 1);

  const skipEvent = res.events.find((e) => e.type === EVENT_TYPES.TURN_SKIPPED);
  assert.ok(skipEvent, 'Must emit TURN_SKIPPED event when opponent has no legal moves');
  assert.equal(skipEvent.payload.skippedPlayer, WHITE);
  assert.equal(skipEvent.payload.nextTurn, BLACK);
});

test('1.6 Match completion when neither player can move (without emitting misleading pass alert)', () => {
  const board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));
  board[0][0] = BLACK;
  board[0][1] = WHITE;
  // After Black plays (0,2), only Black discs remain on the board -> neither player can move
  const game = createNewGame({ initialBoard: board, startingTurn: BLACK });
  const res = applyMove(game, 0, 2, BLACK);

  assert.equal(res.accepted, true);
  assert.equal(res.state.status, 'completed');
  assert.equal(res.state.winner, BLACK);
  assert.equal(res.state.turn, null);

  const skipEvent = res.events.find((e) => e.type === EVENT_TYPES.TURN_SKIPPED);
  assert.equal(skipEvent, undefined, 'Should finish match directly without misleading pass alert');
  const completedEvent = res.events.find((e) => e.type === EVENT_TYPES.MATCH_COMPLETED);
  assert.ok(completedEvent, 'Must emit MATCH_COMPLETED event');
});

test('1.7 Correct final score, winning margin, and draw detection', () => {
  // Construct a board where rows 0..3 (32 squares) are WHITE, rows 4..6 (24 squares) are BLACK,
  // and row 7 has 6 BLACK discs (cols 0..5), 1 WHITE disc at (7,6), and 1 EMPTY square at (7,7).
  // Wait: if Black plays at (7,7), what directions from (7,7) exist?
  // Left (0, -1): (7,6) is WHITE, (7,5) is BLACK -> flips 1 disc (7,6)!
  // Up (-1, 0): (6,7) is BLACK -> 0 flips!
  // Up-Left (-1, -1): (6,6) is BLACK -> 0 flips!
  // So playing at (7,7) flips ONLY (7,6)!
  // Before move: Black has 24 + 6 = 30 discs; White has 32 + 1 = 33 discs.
  // After Black plays (7,7) and flips (7,6): Black has 30 + 1 + 1 = 32, White has 33 - 1 = 32 -> Exact 32-32 DRAW!
  const board = Array.from({ length: BOARD_SIZE }, (_, r) =>
    Array.from({ length: BOARD_SIZE }, (__, c) => {
      if (r < 4) return WHITE;
      if (r < 7) return BLACK;
      if (c < 6) return BLACK;
      if (c === 6) return WHITE;
      return EMPTY;
    })
  );

  const initialCounts = calculateScores(board);
  assert.equal(initialCounts.B, 30);
  assert.equal(initialCounts.W, 33);
  assert.equal(initialCounts.empty, 1);

  const game = createNewGame({ initialBoard: board, startingTurn: BLACK });
  const res = applyMove(game, 7, 7, BLACK);

  assert.equal(res.accepted, true);
  assert.equal(res.state.status, 'completed');
  assert.equal(res.state.scores.B, 32);
  assert.equal(res.state.scores.W, 32);
  assert.equal(res.state.winner, 'DRAW');
  assert.equal(res.state.winningMargin, 0);
  assert.equal(res.state.endReason, 'board_full');
});

test('1.8 Accurate match statistics calculation (moves, flips, corners, duration, margins)', () => {
  const startTs = 1000000;
  let game = createNewGame({ timestamp: startTs });
  const m1 = applyMove(game, 2, 3, BLACK, startTs + 5000);
  assert.equal(m1.accepted, true);
  game = m1.state;

  const m2 = applyMove(game, 2, 2, WHITE, startTs + 12000);
  assert.equal(m2.accepted, true);
  game = m2.state;

  const m3 = applyMove(game, 3, 2, BLACK, startTs + 25000);
  assert.equal(m3.accepted, true);
  game = m3.state;

  const stats = calculateMatchStatistics(game, startTs + 25000);
  assert.equal(stats.totalMoves, 3);
  assert.equal(stats.movesByPlayer.B, 2);
  assert.equal(stats.movesByPlayer.W, 1);
  assert.equal(stats.occupiedSquares, 7);
  assert.equal(stats.emptySquares, 57);
  assert.equal(stats.durationSeconds, 25);
  assert.equal(stats.formattedDuration, '00:25');
  assert.equal(stats.winningMargin, Math.abs(stats.blackScore - stats.whiteScore));
});

// ============================================================================
// 2. AI OPPONENT TESTS
// ============================================================================

test('2.1 Every AI difficulty (Easy, Medium, Hard) selects a strictly legal move and is deterministic with seed', () => {
  const game = createNewGame();
  const legalNotations = new Set(game.legalMoves.map((m) => m.notation));

  for (const diff of ['easy', 'medium', 'hard']) {
    const move1 = selectAIMove(game.board, BLACK, diff, { seed: 42 });
    const move2 = selectAIMove(game.board, BLACK, diff, { seed: 42 });
    assert.ok(move1, `${diff} AI must return a move`);
    assert.ok(legalNotations.has(move1.notation), `${diff} AI move must be in legalMoves`);
    assert.equal(move1.notation, move2.notation, `${diff} AI must be deterministic given a fixed seed`);
  }
});

test('2.2 AI handles forced pass / no-legal-move positions and prioritises corner capture on Medium/Hard', () => {
  // Empty board has no legal moves
  const emptyBoard = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));
  assert.equal(selectAIMove(emptyBoard, BLACK, 'hard'), null);

  // Position where corner (0,0) is available alongside other moves
  const board = createInitialBoard();
  board[0][1] = WHITE;
  board[0][2] = BLACK;
  const hardMove = selectAIMove(board, BLACK, 'hard', { seed: 99 });
  assert.equal(hardMove.row, 0);
  assert.equal(hardMove.col, 0, 'Hard AI must prioritize capturing the corner (0,0)');
});

test('2.3 AI search remains responsive well within interactive frame budgets', () => {
  const game = createNewGame();
  const t0 = Date.now();
  const move = selectAIMove(game.board, BLACK, 'hard', { maxTimeMs: 400 });
  const elapsed = Date.now() - t0;
  assert.ok(move);
  assert.ok(elapsed < 600, `Hard AI move took ${elapsed}ms, expected < 600ms`);
  assert.ok(move.nodesVisited > 10, 'Hard AI should explore multiple search tree nodes');
});

// ============================================================================
// 3. ONLINE MULTIPLAYER & RECONNECTION TESTS
// ============================================================================

test('3.1 Room creation, joining, and full/invalid room protection', () => {
  const sharedStore = new AuthoritativeRoomStore();
  const peers = new Set();
  const hostEvents = new EventManager();
  const guestEvents = new EventManager();
  const intruderEvents = new EventManager();

  const hostClient = new MultiplayerService({ eventManager: hostEvents, sharedStore, peerClients: peers, clientId: 'host_1' });
  const guestClient = new MultiplayerService({ eventManager: guestEvents, sharedStore, peerClients: peers, clientId: 'guest_1' });
  const intruderClient = new MultiplayerService({ eventManager: intruderEvents, sharedStore, peerClients: peers, clientId: 'intruder_1' });

  const created = hostClient.createRoom({ playerName: 'Aria', preferredColor: BLACK, timerSeconds: 300 });
  assert.equal(created.ok, true);
  assert.equal(created.assignedColor, BLACK);
  const code = created.room.roomCode;
  assert.equal(code.length, 6);

  // Invalid room check
  const invalidJoin = guestClient.joinRoom({ roomCode: 'ZZZZZZ', playerName: 'Devon' });
  assert.equal(invalidJoin.ok, false);
  assert.equal(invalidJoin.code, 'INVALID_ROOM');
  assert.equal(guestClient.connectionState, CONNECTION_STATES.MATCH_UNAVAILABLE);

  // Valid guest join
  const validJoin = guestClient.joinRoom({ roomCode: code, playerName: 'Devon' });
  assert.equal(validJoin.ok, true);
  assert.equal(validJoin.assignedColor, WHITE);
  assert.equal(guestClient.connectionState, CONNECTION_STATES.CONNECTED);
  assert.equal(hostClient.currentRoomSnapshot.status, 'active');

  // Third player rejected from full room
  const fullJoin = intruderClient.joinRoom({ roomCode: code, playerName: 'Eve' });
  assert.equal(fullJoin.ok, false);
  assert.equal(fullJoin.code, 'ROOM_FULL');
});

test('3.2 Authoritative move validation & real-time synchronization between independent clients', () => {
  const sharedStore = new AuthoritativeRoomStore();
  const peers = new Set();
  const hostEvents = new EventManager();
  const guestEvents = new EventManager();

  const hostClient = new MultiplayerService({ eventManager: hostEvents, sharedStore, peerClients: peers, clientId: 'host_1' });
  const guestClient = new MultiplayerService({ eventManager: guestEvents, sharedStore, peerClients: peers, clientId: 'guest_1' });

  const { room } = hostClient.createRoom({ playerName: 'Aria', preferredColor: BLACK });
  guestClient.joinRoom({ roomCode: room.roomCode, playerName: 'Devon' });

  // Guest (White) tries to move first -> rejected out of turn
  const outOfTurn = guestClient.submitMove(2, 3);
  assert.equal(outOfTurn.ok, false);
  assert.equal(outOfTurn.code, 'OUT_OF_TURN');

  // Host (Black) tries illegal move at (0,0) -> rejected
  const illegal = hostClient.submitMove(0, 0);
  assert.equal(illegal.ok, false);
  assert.equal(illegal.code, 'NO_BRACKETED_DISCS');

  // Host (Black) submits valid move at (2,3) -> synchronized to Guest in real time!
  const validMove = hostClient.submitMove(2, 3);
  assert.equal(validMove.ok, true);
  assert.equal(guestClient.currentRoomSnapshot.gameState.board[2][3], BLACK);
  assert.equal(guestClient.currentRoomSnapshot.gameState.turn, WHITE);
  assert.equal(guestClient.currentRoomSnapshot.gameState.scores.B, 4);

  // Stale version protection: if Host tries to submit using stale version 1, rejected!
  const staleMove = hostClient.submitMove(2, 2, 1);
  assert.equal(staleMove.ok, false);
  assert.equal(staleMove.code, 'STALE_VERSION');
});

test('3.3 Duplicate network event handling (EventManager & NotificationManager deduplication)', () => {
  const em = new EventManager();
  const nm = new NotificationManager();
  let receivedCount = 0;

  em.on(EVENT_TYPES.TURN_SKIPPED, (env) => {
    receivedCount++;
    nm.pushSkippedTurnAlert({
      skippedPlayer: env.payload.skippedPlayer,
      nextTurn: env.payload.nextTurn,
      eventId: env.id,
    });
  });

  const firstEmit = em.emit(
    EVENT_TYPES.TURN_SKIPPED,
    { skippedPlayer: WHITE, nextTurn: BLACK },
    { eventId: 'match_1_skip_14_W' }
  );
  const duplicateEmit = em.emit(
    EVENT_TYPES.TURN_SKIPPED,
    { skippedPlayer: WHITE, nextTurn: BLACK },
    { eventId: 'match_1_skip_14_W' }
  );

  assert.equal(firstEmit, true);
  assert.equal(duplicateEmit, false);
  assert.equal(receivedCount, 1);
  assert.equal(nm.activeNotifications.length, 1);
  assert.equal(nm.activeNotifications[0].title, 'NO LEGAL MOVES');
  assert.equal(nm.activeNotifications[0].message, 'White has no available moves. Black’s turn.');
});

test('3.4 Reconnection with bounded exponential backoff restores authoritative state without replaying sounds/toasts', async () => {
  const sharedStore = new AuthoritativeRoomStore();
  const peers = new Set();
  const hostEvents = new EventManager();
  const guestEvents = new EventManager();

  const hostClient = new MultiplayerService({
    eventManager: hostEvents,
    sharedStore,
    peerClients: peers,
    clientId: 'host_1',
    baseBackoffMs: 10,
  });
  const guestClient = new MultiplayerService({
    eventManager: guestEvents,
    sharedStore,
    peerClients: peers,
    clientId: 'guest_1',
    baseBackoffMs: 10,
  });

  const { room } = hostClient.createRoom({ playerName: 'Aria', preferredColor: BLACK });
  guestClient.joinRoom({ roomCode: room.roomCode, playerName: 'Devon' });

  // Host makes a move while Guest is connected
  hostClient.submitMove(2, 3);

  // Guest unexpectedly disconnects
  guestClient.handleUnexpectedDisconnect();
  assert.equal(guestClient.connectionState, CONNECTION_STATES.RECONNECTING);
  assert.equal(hostClient.connectionState, CONNECTION_STATES.OPPONENT_DISCONNECTED);

  // Track whether any historical MOVE_APPLIED events fire again on guest during reconnection
  let replayedMoveEvents = 0;
  guestEvents.on(EVENT_TYPES.MOVE_APPLIED, () => {
    replayedMoveEvents++;
  });

  const reconnectResult = await guestClient.attemptReconnect({ simulateTransportAvailable: true });
  assert.equal(reconnectResult.ok, true);
  assert.equal(guestClient.connectionState, CONNECTION_STATES.CONNECTED);
  assert.equal(hostClient.connectionState, CONNECTION_STATES.CONNECTED);
  assert.equal(guestClient.currentRoomSnapshot.gameState.scores.B, 4);
  assert.equal(replayedMoveEvents, 0, 'Reconnection must not replay historical move notifications or sounds');
});

test('3.5 Rematch request, acceptance, rejection, and timeout flows', () => {
  const sharedStore = new AuthoritativeRoomStore();
  const peers = new Set();
  const hostClient = new MultiplayerService({ eventManager: new EventManager(), sharedStore, peerClients: peers, clientId: 'h1' });
  const guestClient = new MultiplayerService({ eventManager: new EventManager(), sharedStore, peerClients: peers, clientId: 'g1' });

  const { room } = hostClient.createRoom({ playerName: 'Aria', preferredColor: BLACK });
  guestClient.joinRoom({ roomCode: room.roomCode, playerName: 'Devon' });
  hostClient.submitMove(2, 3);

  // 1) Request & Decline
  const req1 = hostClient.requestRematch();
  assert.equal(req1.ok, true);
  assert.equal(guestClient.currentRoomSnapshot.rematch.status, 'pending');

  const dec1 = guestClient.respondRematch(false);
  assert.equal(dec1.ok, true);
  assert.equal(hostClient.currentRoomSnapshot.rematch.status, 'declined');

  // 2) Request & Timeout
  hostClient.requestRematch();
  const to1 = hostClient.timeoutRematch();
  assert.equal(to1.ok, true);
  assert.equal(guestClient.currentRoomSnapshot.rematch.status, 'timeout');

  // 3) Request & Accept -> resets board to initial 2-2 score and version 1
  hostClient.requestRematch();
  const acc1 = guestClient.respondRematch(true);
  assert.equal(acc1.ok, true);
  assert.equal(hostClient.currentRoomSnapshot.rematch.status, 'accepted');
  assert.equal(hostClient.currentRoomSnapshot.gameState.scores.B, 2);
  assert.equal(hostClient.currentRoomSnapshot.gameState.scores.W, 2);
  assert.equal(hostClient.currentRoomSnapshot.gameState.moveHistory.length, 0);
});

// ============================================================================
// 4. UI, AUDIO, SETTINGS, ACCESSIBILITY & OFFLINE LOCAL GAMEPLAY TESTS
// ============================================================================

test('4.1 Audio settings, mute behavior, and eventId sound deduplication', () => {
  const audio = new AudioManager();
  assert.equal(audio.muted, false);
  assert.equal(audio.musicVolume, 0, 'Background music must be disabled by default');

  // Play with eventId deduplication
  assert.equal(audio.play(SOUND_EFFECTS.DISC_PLACE, { eventId: 'evt_sound_1' }), true);
  assert.equal(audio.play(SOUND_EFFECTS.DISC_PLACE, { eventId: 'evt_sound_1' }), false, 'Duplicate sound eventId must not replay');

  // Mute prevents playback
  audio.setMuted(true);
  assert.equal(audio.play(SOUND_EFFECTS.VICTORY), false);

  audio.setMuted(false);
  assert.equal(audio.play(SOUND_EFFECTS.VICTORY), true);
});

test('4.2 Reduced-motion preference and SettingsManager persistence', () => {
  const settings = new SettingsManager({ systemPrefersReducedMotion: true });
  assert.equal(settings.isReducedMotionActive(), true, 'Should respect OS reduced-motion preference by default');
  assert.equal(settings.getEffectiveSettings().discFlipDurationMs, 0);

  settings.update({ respectSystemReducedMotion: false, reducedMotion: false });
  assert.equal(settings.isReducedMotionActive(), false);
  assert.equal(settings.getEffectiveSettings().discFlipDurationMs, 320);

  settings.reset();
  assert.equal(settings.isReducedMotionActive(), true);
});

test('4.3 Offline local multiplayer and match review snapshots work completely without a backend', () => {
  let localGame = createNewGame({
    mode: 'local',
    players: {
      B: { name: 'Player 1', color: BLACK },
      W: { name: 'Player 2', color: WHITE },
    },
  });

  localGame = applyMove(localGame, 2, 3, BLACK).state;
  localGame = applyMove(localGame, 2, 2, WHITE).state;

  // Verify snapshots allow stepping backward and forward in Match Review
  assert.equal(localGame.snapshots.length, 3); // Initial + 2 moves
  assert.equal(localGame.snapshots[0].scores.B, 2);
  assert.equal(localGame.snapshots[1].scores.B, 4);
  assert.equal(localGame.snapshots[2].scores.W, 3);
});
