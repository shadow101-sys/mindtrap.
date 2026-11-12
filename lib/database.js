"use strict";

let pool = null;
const writeQueues = new Map();

function snapshotRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    players: room.players.map(player => ({
      ...player,
      tokenHash: Buffer.isBuffer(player.tokenHash) ? player.tokenHash.toString("hex") : String(player.tokenHash || ""),
      socketId: null,
      connected: false,
      voiceEnabled: false,
      lastWorldMoveAt: 0
    })),
    phase: room.phase,
    round: room.round,
    settings: room.settings,
    roles: room.roles,
    word: room.word,
    wordSetterId: room.wordSetterId,
    clues: room.clues,
    votes: room.votes,
    winner: room.winner,
    lastVoteResults: room.lastVoteResults,
    waitingPhase: room.waitingPhase,
    chatHistory: room.chatHistory
  };
}

async function initializeDatabase() {
  if (!process.env.DATABASE_URL) return [];
  const { Pool } = require("pg");
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX) || 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true
  });
  pool.on("error", error => console.error("Unexpected PostgreSQL pool error.", error));
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mindtrap_room_snapshots (
      room_code VARCHAR(6) PRIMARY KEY,
      snapshot JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const result = await pool.query("SELECT snapshot FROM mindtrap_room_snapshots ORDER BY updated_at DESC");
  return result.rows.map(row => row.snapshot).filter(Boolean);
}

function enqueueWrite(key, operation) {
  if (!pool) return Promise.resolve();
  const previous = writeQueues.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  writeQueues.set(key, next);
  return next.finally(() => {
    if (writeQueues.get(key) === next) writeQueues.delete(key);
  });
}

function saveRoom(room) {
  if (!pool || !room?.code) return Promise.resolve();
  const snapshot = snapshotRoom(room);
  return enqueueWrite(room.code, () => pool.query(
    `INSERT INTO mindtrap_room_snapshots (room_code, snapshot, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (room_code) DO UPDATE
     SET snapshot = EXCLUDED.snapshot, updated_at = NOW()`,
    [room.code, JSON.stringify(snapshot)]
  )).catch(error => console.error(`Could not persist room ${room.code}.`, error));
}

function deleteRoom(roomCode) {
  if (!pool || !roomCode) return Promise.resolve();
  return enqueueWrite(roomCode, () => pool.query(
    "DELETE FROM mindtrap_room_snapshots WHERE room_code = $1",
    [roomCode]
  )).catch(error => console.error(`Could not delete persisted room ${roomCode}.`, error));
}

async function healthCheck() {
  if (!pool) return { enabled: false };
  await pool.query("SELECT 1");
  return { enabled: true };
}

async function closeDatabase() {
  if (!pool) return;
  await Promise.allSettled([...writeQueues.values()]);
  await pool.end();
  pool = null;
}

module.exports = { snapshotRoom, initializeDatabase, saveRoom, deleteRoom, healthCheck, closeDatabase };
