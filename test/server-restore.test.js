"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { restoreRoom } = require("../server");

test("restored rooms keep match state but require players to reconnect", () => {
  const snapshot = {
    code: "ABC123",
    hostId: "player-1",
    players: [{
      id: "player-1",
      tokenHash: "a".repeat(64),
      socketId: "old-socket",
      connected: true,
      voiceEnabled: true,
      lastWorldMoveAt: 12345,
      position: { x: 3, z: -4, yaw: 1.2 }
    }],
    phase: "clues",
    round: 2,
    settings: { maxPlayers: 8, impostors: 1, shadowEnabled: true },
    roles: { "player-1": "innocent" },
    word: "MANGO",
    wordSetterId: "player-1",
    clues: [],
    votes: [],
    winner: null,
    lastVoteResults: null,
    waitingPhase: null,
    chatHistory: []
  };

  const room = restoreRoom(snapshot);

  assert.equal(room.phase, "clues");
  assert.equal(room.round, 2);
  assert.equal(room.word, "MANGO");
  assert.equal(room.roles["player-1"], "innocent");
  assert.equal(room.players[0].tokenHash.length, 32);
  assert.equal(room.players[0].socketId, null);
  assert.equal(room.players[0].connected, false);
  assert.equal(room.players[0].voiceEnabled, false);
  assert.equal(room.players[0].lastWorldMoveAt, 0);
  assert.equal(room.phaseTimer, null);
  assert.equal(room.phaseDeadline, null);
});
