"use strict";

var _nodeTest = _interopRequireDefault(require("node:test"));
var _strict = _interopRequireDefault(require("node:assert/strict"));
var _MultiplayerEngine = require("../src/multiplayer/MultiplayerEngine");
var _EventManager = require("../src/events/EventManager");
var _AudioManager = require("../src/audio/AudioManager");
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
(0, _nodeTest.default)('Multiplayer Test 1: Private room creation, unique room code, and second client joining', () => {
  const store = new _MultiplayerEngine.AuthoritativeRoomStore();
  const eventsA = new _EventManager.EventManager();
  const eventsB = new _EventManager.EventManager();
  const clientA = new _MultiplayerEngine.MultiplayerClientSession(store, eventsA);
  const clientB = new _MultiplayerEngine.MultiplayerClientSession(store, eventsB);
  const createRes = clientA.createPrivateRoom({
    nickname: 'Aria',
    preferredColor: 'B',
    now: 1000
  });
  _strict.default.equal(createRes.ok, true);
  _strict.default.equal(createRes.assignedColor, 'B');
  _strict.default.equal(createRes.room?.roomCode.length, 6);
  _strict.default.equal(createRes.room?.players.B?.nickname, 'Aria');
  _strict.default.equal(createRes.room?.players.W, null, 'Opponent slot must be empty before join');
  const code = createRes.room.roomCode;
  const joinRes = clientB.joinExistingRoom({
    roomCode: code,
    nickname: 'Soren',
    now: 1500
  });
  _strict.default.equal(joinRes.ok, true);
  _strict.default.equal(joinRes.assignedColor, 'W');
  _strict.default.equal(joinRes.room?.players.W?.nickname, 'Soren');
  _strict.default.equal(joinRes.room?.players.W?.connected, true);
  const eventsC = new _EventManager.EventManager();
  const clientC = new _MultiplayerEngine.MultiplayerClientSession(store, eventsC);
  const fullRes = clientC.joinExistingRoom({
    roomCode: code,
    nickname: 'Intruder',
    now: 1600
  });
  _strict.default.equal(fullRes.ok, false);
  _strict.default.equal(fullRes.code, 'ROOM_FULL');
});
(0, _nodeTest.default)('Multiplayer Test 2: Authoritative move validation, turn enforcement, and anti-stale-overwrite', () => {
  const store = new _MultiplayerEngine.AuthoritativeRoomStore();
  const clientA = new _MultiplayerEngine.MultiplayerClientSession(store, new _EventManager.EventManager());
  const clientB = new _MultiplayerEngine.MultiplayerClientSession(store, new _EventManager.EventManager());
  const {
    room,
    playerToken: tokenA
  } = clientA.createPrivateRoom({
    nickname: 'BlackPlayer',
    preferredColor: 'B',
    now: 1000
  });
  const roomCode = room.roomCode;
  clientB.joinExistingRoom({
    roomCode,
    nickname: 'WhitePlayer',
    now: 1100
  });
  const wrongTurn = clientB.makeMove(2, 3, 1200);
  _strict.default.equal(wrongTurn.ok, false);
  _strict.default.equal(wrongTurn.code, 'ILLEGAL_MOVE');
  const unauth = store.submitMove({
    roomCode,
    playerToken: 'forged_token_123',
    row: 2,
    col: 3,
    now: 1250
  });
  _strict.default.equal(unauth.ok, false);
  _strict.default.equal(unauth.code, 'UNAUTHORIZED');
  const illegalCoord = clientA.makeMove(0, 0, 1300);
  _strict.default.equal(illegalCoord.ok, false);
  _strict.default.equal(illegalCoord.code, 'ILLEGAL_MOVE');
  const validMove = clientA.makeMove(2, 3, 1400);
  _strict.default.equal(validMove.ok, true);
  _strict.default.equal(clientA.getRoomSnapshot()?.gameState.blackScore, 4);
  _strict.default.equal(clientB.getRoomSnapshot()?.gameState.blackScore, 4);
  _strict.default.equal(clientB.getRoomSnapshot()?.gameState.currentTurn, 'W');
  const staleRes = store.submitMove({
    roomCode,
    playerToken: tokenA,
    row: 2,
    col: 2,
    expectedVersion: 1,
    now: 1500
  });
  _strict.default.equal(staleRes.ok, false);
  _strict.default.equal(staleRes.code, 'STALE_STATE');
});
(0, _nodeTest.default)('Multiplayer Test 3: Real-time synchronization and duplicate event deduplication', () => {
  const store = new _MultiplayerEngine.AuthoritativeRoomStore();
  const eventsA = new _EventManager.EventManager();
  const eventsB = new _EventManager.EventManager();
  const clientA = new _MultiplayerEngine.MultiplayerClientSession(store, eventsA);
  const clientB = new _MultiplayerEngine.MultiplayerClientSession(store, eventsB);
  let bReceivedMoves = 0;
  eventsB.on('MOVE_ACCEPTED', () => {
    bReceivedMoves++;
  });
  const created = clientA.createPrivateRoom({
    nickname: 'Host',
    preferredColor: 'B',
    now: 1000
  });
  clientB.joinExistingRoom({
    roomCode: created.room.roomCode,
    nickname: 'Guest',
    now: 1100
  });
  const moveRes = clientA.makeMove(2, 3, 1200);
  _strict.default.equal(moveRes.ok, true);
  _strict.default.equal(bReceivedMoves, 1, 'Client B must receive real-time MOVE_ACCEPTED event');
  const moveEvent = moveRes.events.find(e => e.type === 'MOVE_ACCEPTED');
  const emittedAgain = eventsB.emit(moveEvent);
  _strict.default.equal(emittedAgain, false, 'Duplicate network eventId must be suppressed');
  _strict.default.equal(bReceivedMoves, 1);
});
(0, _nodeTest.default)('Multiplayer Test 4: Disconnection detection, bounded exponential backoff reconnection, and state restoration', async () => {
  const store = new _MultiplayerEngine.AuthoritativeRoomStore();
  const eventsA = new _EventManager.EventManager();
  const eventsB = new _EventManager.EventManager();
  const clientA = new _MultiplayerEngine.MultiplayerClientSession(store, eventsA, {
    maxRetries: 3,
    baseDelayMs: 10,
    maxDelayMs: 40
  });
  const clientB = new _MultiplayerEngine.MultiplayerClientSession(store, eventsB, {
    maxRetries: 3,
    baseDelayMs: 10,
    maxDelayMs: 40
  });
  const {
    room
  } = clientA.createPrivateRoom({
    nickname: 'Host',
    preferredColor: 'B',
    now: 1000
  });
  const code = room.roomCode;
  clientB.joinExistingRoom({
    roomCode: code,
    nickname: 'Guest',
    now: 1100
  });
  clientA.makeMove(2, 3, 1200);
  clientB.simulateDisconnect(1300);
  _strict.default.equal(clientB.getConnectionStatus(), 'Reconnecting');
  _strict.default.equal(clientA.getConnectionStatus(), 'Opponent Disconnected');
  const reconRes = await clientB.reconnectWithBackoff(1, 1500);
  _strict.default.equal(reconRes.ok, true);
  _strict.default.equal(clientB.getConnectionStatus(), 'Connection Restored');
  _strict.default.equal(clientA.getConnectionStatus(), 'Connected');
  _strict.default.equal(clientB.getRoomSnapshot()?.gameState.blackScore, 4);
  _strict.default.equal(clientB.getRoomSnapshot()?.gameState.currentTurn, 'W');
});
(0, _nodeTest.default)('Multiplayer Test 5: Rematch request, acceptance, rejection, and timeout', () => {
  const store = new _MultiplayerEngine.AuthoritativeRoomStore();
  const clientA = new _MultiplayerEngine.MultiplayerClientSession(store, new _EventManager.EventManager());
  const clientB = new _MultiplayerEngine.MultiplayerClientSession(store, new _EventManager.EventManager());
  const {
    room
  } = clientA.createPrivateRoom({
    nickname: 'Host',
    preferredColor: 'B',
    now: 1000
  });
  const code = room.roomCode;
  clientB.joinExistingRoom({
    roomCode: code,
    nickname: 'Guest',
    now: 1100
  });
  clientA.makeMove(2, 3, 1200);
  const req1 = clientA.requestRematch(2000);
  _strict.default.equal(req1.ok, true);
  _strict.default.equal(clientB.getRoomSnapshot()?.rematch.status, 'pending');
  const dec1 = clientB.respondRematch(false, 2500);
  _strict.default.equal(dec1.ok, true);
  _strict.default.equal(clientA.getRoomSnapshot()?.rematch.status, 'declined');
  clientA.requestRematch(3000);
  const afterTimeout = store.checkRematchTimeout(code, 35000);
  _strict.default.equal(afterTimeout?.rematch.status, 'timeout');
  clientA.requestRematch(36000);
  const acc = clientB.respondRematch(true, 36500);
  _strict.default.equal(acc.ok, true);
  _strict.default.equal(acc.room?.rematch.status, 'accepted');
  _strict.default.equal(acc.room?.gameState.blackScore, 2);
  _strict.default.equal(acc.room?.gameState.whiteScore, 2);
  _strict.default.equal(acc.room?.gameState.currentTurn, 'B');
  _strict.default.equal(acc.room?.gameState.moveHistory.length, 0);
});
(0, _nodeTest.default)('UI/System Test 6: Notification deduplication and AudioManager mute/gesture rules', () => {
  const notifications = new _EventManager.NotificationManager();
  const first = notifications.notify({
    id: 'skip_evt_1',
    category: 'skipped_turn',
    title: 'NO LEGAL MOVES',
    message: "Black has no available moves. White's turn.",
    durationMs: 4000
  });
  const duplicate = notifications.notify({
    id: 'skip_evt_1',
    category: 'skipped_turn',
    title: 'NO LEGAL MOVES',
    message: "Black has no available moves. White's turn.",
    durationMs: 4000
  });
  _strict.default.equal(first, true);
  _strict.default.equal(duplicate, false, 'Duplicate notification ID must be ignored');
  _strict.default.equal(notifications.getActive().length, 1);
  const audio = new _AudioManager.AudioManager({
    masterMute: false,
    sfxVolume: 0.8
  });
  _strict.default.equal(audio.play('disc_place'), false);
  audio.unlockOnUserGesture();
  _strict.default.equal(audio.play('disc_place', {
    eventId: 'move_1_sound'
  }), true);
  _strict.default.equal(audio.play('disc_place', {
    eventId: 'move_1_sound'
  }), false);
  audio.updatePreferences({
    masterMute: true
  });
  _strict.default.equal(audio.play('victory'), false);
});