import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AuthoritativeRoomStore,
  MultiplayerClientSession,
} from '../src/multiplayer/MultiplayerEngine';
import { EventManager, NotificationManager } from '../src/events/EventManager';
import { AudioManager } from '../src/audio/AudioManager';

test('Multiplayer Test 1: Private room creation, unique room code, and second client joining', () => {
  const store = new AuthoritativeRoomStore();
  const eventsA = new EventManager();
  const eventsB = new EventManager();

  const clientA = new MultiplayerClientSession(store, eventsA);
  const clientB = new MultiplayerClientSession(store, eventsB);

  const createRes = clientA.createPrivateRoom({
    nickname: 'Aria',
    preferredColor: 'B',
    now: 1000,
  });
  assert.equal(createRes.ok, true);
  assert.equal(createRes.assignedColor, 'B');
  assert.equal(createRes.room?.roomCode.length, 6);
  assert.equal(createRes.room?.players.B?.nickname, 'Aria');
  assert.equal(createRes.room?.players.W, null, 'Opponent slot must be empty before join');

  const code = createRes.room!.roomCode;
  const joinRes = clientB.joinExistingRoom({
    roomCode: code,
    nickname: 'Soren',
    now: 1500,
  });
  assert.equal(joinRes.ok, true);
  assert.equal(joinRes.assignedColor, 'W');
  assert.equal(joinRes.room?.players.W?.nickname, 'Soren');
  assert.equal(joinRes.room?.players.W?.connected, true);

  const eventsC = new EventManager();
  const clientC = new MultiplayerClientSession(store, eventsC);
  const fullRes = clientC.joinExistingRoom({
    roomCode: code,
    nickname: 'Intruder',
    now: 1600,
  });
  assert.equal(fullRes.ok, false);
  assert.equal(fullRes.code, 'ROOM_FULL');
});

test('Multiplayer Test 2: Authoritative move validation, turn enforcement, and anti-stale-overwrite', () => {
  const store = new AuthoritativeRoomStore();
  const clientA = new MultiplayerClientSession(store, new EventManager());
  const clientB = new MultiplayerClientSession(store, new EventManager());

  const { room, playerToken: tokenA } = clientA.createPrivateRoom({
    nickname: 'BlackPlayer',
    preferredColor: 'B',
    now: 1000,
  });
  const roomCode = room!.roomCode;
  clientB.joinExistingRoom({ roomCode, nickname: 'WhitePlayer', now: 1100 });

  const wrongTurn = clientB.makeMove(2, 3, 1200);
  assert.equal(wrongTurn.ok, false);
  assert.equal(wrongTurn.code, 'ILLEGAL_MOVE');

  const unauth = store.submitMove({
    roomCode,
    playerToken: 'forged_token_123',
    row: 2,
    col: 3,
    now: 1250,
  });
  assert.equal(unauth.ok, false);
  assert.equal(unauth.code, 'UNAUTHORIZED');

  const illegalCoord = clientA.makeMove(0, 0, 1300);
  assert.equal(illegalCoord.ok, false);
  assert.equal(illegalCoord.code, 'ILLEGAL_MOVE');

  const validMove = clientA.makeMove(2, 3, 1400);
  assert.equal(validMove.ok, true);
  assert.equal(clientA.getRoomSnapshot()?.gameState.blackScore, 4);
  assert.equal(clientB.getRoomSnapshot()?.gameState.blackScore, 4);
  assert.equal(clientB.getRoomSnapshot()?.gameState.currentTurn, 'W');

  const staleRes = store.submitMove({
    roomCode,
    playerToken: tokenA!,
    row: 2,
    col: 2,
    expectedVersion: 1,
    now: 1500,
  });
  assert.equal(staleRes.ok, false);
  assert.equal(staleRes.code, 'STALE_STATE');
});

test('Multiplayer Test 3: Real-time synchronization and duplicate event deduplication', () => {
  const store = new AuthoritativeRoomStore();
  const eventsA = new EventManager();
  const eventsB = new EventManager();
  const clientA = new MultiplayerClientSession(store, eventsA);
  const clientB = new MultiplayerClientSession(store, eventsB);

  let bReceivedMoves = 0;
  eventsB.on('MOVE_ACCEPTED', () => {
    bReceivedMoves++;
  });

  const created = clientA.createPrivateRoom({ nickname: 'Host', preferredColor: 'B', now: 1000 });
  clientB.joinExistingRoom({ roomCode: created.room!.roomCode, nickname: 'Guest', now: 1100 });

  const moveRes = clientA.makeMove(2, 3, 1200);
  assert.equal(moveRes.ok, true);
  assert.equal(bReceivedMoves, 1, 'Client B must receive real-time MOVE_ACCEPTED event');

  const moveEvent = moveRes.events!.find((e) => e.type === 'MOVE_ACCEPTED')!;
  const emittedAgain = eventsB.emit(moveEvent);
  assert.equal(emittedAgain, false, 'Duplicate network eventId must be suppressed');
  assert.equal(bReceivedMoves, 1);
});

test('Multiplayer Test 4: Disconnection detection, bounded exponential backoff reconnection, and state restoration', async () => {
  const store = new AuthoritativeRoomStore();
  const eventsA = new EventManager();
  const eventsB = new EventManager();
  const clientA = new MultiplayerClientSession(store, eventsA, {
    maxRetries: 3,
    baseDelayMs: 10,
    maxDelayMs: 40,
  });
  const clientB = new MultiplayerClientSession(store, eventsB, {
    maxRetries: 3,
    baseDelayMs: 10,
    maxDelayMs: 40,
  });

  const { room } = clientA.createPrivateRoom({ nickname: 'Host', preferredColor: 'B', now: 1000 });
  const code = room!.roomCode;
  clientB.joinExistingRoom({ roomCode: code, nickname: 'Guest', now: 1100 });

  clientA.makeMove(2, 3, 1200);
  clientB.simulateDisconnect(1300);

  assert.equal(clientB.getConnectionStatus(), 'Reconnecting');
  assert.equal(clientA.getConnectionStatus(), 'Opponent Disconnected');

  const reconRes = await clientB.reconnectWithBackoff(1, 1500);
  assert.equal(reconRes.ok, true);
  assert.equal(clientB.getConnectionStatus(), 'Connection Restored');
  assert.equal(clientA.getConnectionStatus(), 'Connected');
  assert.equal(clientB.getRoomSnapshot()?.gameState.blackScore, 4);
  assert.equal(clientB.getRoomSnapshot()?.gameState.currentTurn, 'W');
});

test('Multiplayer Test 5: Rematch request, acceptance, rejection, and timeout', () => {
  const store = new AuthoritativeRoomStore();
  const clientA = new MultiplayerClientSession(store, new EventManager());
  const clientB = new MultiplayerClientSession(store, new EventManager());

  const { room } = clientA.createPrivateRoom({ nickname: 'Host', preferredColor: 'B', now: 1000 });
  const code = room!.roomCode;
  clientB.joinExistingRoom({ roomCode: code, nickname: 'Guest', now: 1100 });

  clientA.makeMove(2, 3, 1200);
  const req1 = clientA.requestRematch(2000);
  assert.equal(req1.ok, true);
  assert.equal(clientB.getRoomSnapshot()?.rematch.status, 'pending');

  const dec1 = clientB.respondRematch(false, 2500);
  assert.equal(dec1.ok, true);
  assert.equal(clientA.getRoomSnapshot()?.rematch.status, 'declined');

  clientA.requestRematch(3000);
  const afterTimeout = store.checkRematchTimeout(code, 35000);
  assert.equal(afterTimeout?.rematch.status, 'timeout');

  clientA.requestRematch(36000);
  const acc = clientB.respondRematch(true, 36500);
  assert.equal(acc.ok, true);
  assert.equal(acc.room?.rematch.status, 'accepted');
  assert.equal(acc.room?.gameState.blackScore, 2);
  assert.equal(acc.room?.gameState.whiteScore, 2);
  assert.equal(acc.room?.gameState.currentTurn, 'B');
  assert.equal(acc.room?.gameState.moveHistory.length, 0);
});

test('UI/System Test 6: Notification deduplication and AudioManager mute/gesture rules', () => {
  const notifications = new NotificationManager();
  const first = notifications.notify({
    id: 'skip_evt_1',
    category: 'skipped_turn',
    title: 'NO LEGAL MOVES',
    message: "Black has no available moves. White's turn.",
    durationMs: 4000,
  });
  const duplicate = notifications.notify({
    id: 'skip_evt_1',
    category: 'skipped_turn',
    title: 'NO LEGAL MOVES',
    message: "Black has no available moves. White's turn.",
    durationMs: 4000,
  });
  assert.equal(first, true);
  assert.equal(duplicate, false, 'Duplicate notification ID must be ignored');
  assert.equal(notifications.getActive().length, 1);

  const audio = new AudioManager({ masterMute: false, sfxVolume: 0.8 });
  assert.equal(audio.play('disc_place'), false);

  audio.unlockOnUserGesture();
  assert.equal(audio.play('disc_place', { eventId: 'move_1_sound' }), true);
  assert.equal(audio.play('disc_place', { eventId: 'move_1_sound' }), false);

  audio.updatePreferences({ masterMute: true });
  assert.equal(audio.play('victory'), false);
});
