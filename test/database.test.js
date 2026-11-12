"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { snapshotRoom } = require("../lib/database");

test("room snapshots persist only the rejoin-token hash and clear live connection state", () => {
  const tokenHash = Buffer.from("a".repeat(64), "hex");
  const room = {
    code: "ABC123",
    hostId: "player-1",
    players: [{
      id: "player-1",
      tokenHash,
      socketId: "private-socket-id",
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

  const snapshot = snapshotRoom(room);
  const serialized = JSON.stringify(snapshot);

  assert.equal(snapshot.players[0].tokenHash, tokenHash.toString("hex"));
  assert.equal(snapshot.players[0].socketId, null);
  assert.equal(snapshot.players[0].connected, false);
  assert.equal(snapshot.players[0].voiceEnabled, false);
  assert.equal(snapshot.players[0].lastWorldMoveAt, 0);
  assert.deepEqual(snapshot.players[0].position, room.players[0].position);
  assert.equal(serialized.includes("private-socket-id"), false);
  assert.equal(serialized.includes(tokenHash.toString("hex")), true);
});
