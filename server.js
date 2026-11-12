"use strict";

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");
const { countVotes, groupVoteCounts, maxBalancedImpostors, assignRoles, canSetWord, personalOutcome } = require("./lib/game-logic");
const { spawnPosition, clampWorldPosition } = require("./lib/world-logic");
const database = require("./lib/database");

const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = 15;
const ROOM_IDLE_TTL = 10 * 60 * 1000;
const PHASE_DURATIONS = {
  "word-entry": 90 * 1000,
  ready: 45 * 1000,
  clues: 90 * 1000,
  voting: 60 * 1000
};
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000"
];
const allowedOrigins = new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...String(process.env.ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean)
]);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ["GET", "POST"] },
  allowRequest(request, callback) {
    const origin = request.headers.origin;
    const protocol = String(request.headers["x-forwarded-proto"] || (request.socket.encrypted ? "https" : "http")).split(",")[0].trim();
    const host = String(request.headers["x-forwarded-host"] || request.headers.host || "").split(",")[0].trim();
    const sameOrigin = origin && host && origin === `${protocol}://${host}`;
    callback(null, !origin || sameOrigin || allowedOrigins.has(origin));
  },
  pingInterval: 25000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e6
});

const rooms = new Map();
const turnUrls = String(process.env.TURN_URLS || "").split(",").map(value => value.trim()).filter(Boolean);
const iceServers = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
];
if (turnUrls.length && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
  iceServers.push({
    urls: turnUrls,
    username: process.env.TURN_USERNAME,
    credential: process.env.TURN_CREDENTIAL
  });
}

app.get("/runtime-config.js", (_request, response) => {
  response.set("Cache-Control", "no-store");
  response.type("application/javascript").send(`window.MINDTRAP_CONFIG = ${JSON.stringify({ iceServers })};`);
});
app.get("/health", async (_request, response) => {
  try {
    const db = await database.healthCheck();
    response.json({ ok: true, service: "mindtrap", database: db.enabled ? "connected" : "disabled" });
  } catch (error) {
    console.error("Health check failed.", error);
    response.status(503).json({ ok: false, service: "mindtrap", database: "unavailable" });
  }
});
app.use(express.static(path.join(__dirname, "public")));

const random = items => items[crypto.randomInt(items.length)];
const roomCode = () => crypto.randomBytes(3).toString("hex").toUpperCase();
const tokenHash = token => crypto.createHash("sha256").update(token).digest();

function ack(callback, result) {
  if (typeof callback === "function") callback(result);
}
function rateLimit(socket, key, limit, windowMs) {
  const now = Date.now();
  socket.data.rateLimits ||= new Map();
  const current = socket.data.rateLimits.get(key) || { start: now, count: 0 };
  if (now - current.start >= windowMs) {
    current.start = now;
    current.count = 0;
  }
  current.count += 1;
  socket.data.rateLimits.set(key, current);
  return current.count <= limit;
}
function findRoomForSocket(socketId) {
  for (const room of rooms.values()) {
    if (room.players.some(player => player.socketId === socketId && player.connected)) return room;
  }
  return null;
}
function findPlayer(room, playerId) {
  return room.players.find(player => player.id === playerId);
}
function findPlayerForSocket(room, socketId) {
  return room.players.find(player => player.socketId === socketId && player.connected);
}
function activePlayers(room) {
  return room.players.filter(player => !player.eliminated);
}
function connectedActivePlayers(room) {
  return room.players.filter(player => player.connected && !player.eliminated);
}
function livingRolePlayers(room) {
  return activePlayers(room).filter(player => room.roles[player.id]);
}
function clearRoomTimers(room) {
  if (room.phaseTimer) clearTimeout(room.phaseTimer);
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  room.phaseTimer = null;
  room.cleanupTimer = null;
  room.phaseDeadline = null;
}

function publicRoom(room) {
  const revealClues = room.phase === "voting";
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    phaseDeadline: room.phaseDeadline,
    settings: room.settings,
    players: room.players.map(player => ({
      id: player.id,
      socketId: player.connected ? player.socketId : null,
      name: player.name,
      isHost: player.id === room.hostId,
      connected: player.connected,
      eliminated: player.eliminated,
      voiceEnabled: player.connected && player.voiceEnabled,
      position: player.position,
      ready: room.phase === "ready" && player.ready,
      hasSubmittedClue: room.phase === "clues" && player.clueSubmitted
    })),
    readyCount: connectedActivePlayers(room).filter(player => player.ready).length,
    clueCount: connectedActivePlayers(room).filter(player => player.clueSubmitted).length,
    voteCount: room.votes.filter(vote => connectedActivePlayers(room).some(player => player.id === vote.voterId)).length,
    requiredActions: connectedActivePlayers(room).length,
    clues: revealClues ? room.clues.map(clue => ({ playerId: clue.playerId, text: clue.text })) : [],
    wordSubmitted: !!room.word,
    wordSetterOffline: room.phase === "word-entry" && !findPlayer(room, room.wordSetterId)?.connected,
    lastVoteResults: room.lastVoteResults,
    winner: room.winner,
    chatHistory: room.chatHistory.slice(-50)
  };
}

function personalResultFor(room, player) {
  const role = room.roles[player.id] || null;
  return room.winner ? personalOutcome(role, room.winner.role) : null;
}
function sendPrivateState(room) {
  for (const player of room.players) {
    if (!player.connected || !player.socketId) continue;
    const role = room.roles[player.id] || null;
    io.to(player.socketId).emit("game:private", {
      playerId: player.id,
      phase: room.phase,
      round: room.round,
      role,
      word: role === "innocent" || role === "shadow" ? room.word : null,
      isWordSetter: room.wordSetterId === player.id,
      ready: player.ready,
      clueDraft: player.clueDraft,
      hasSubmittedClue: player.clueSubmitted,
      hasVoted: room.votes.some(vote => vote.voterId === player.id),
      result: personalResultFor(room, player)
    });
  }
}

function eligibleWordSetters(room, excludedId = null) {
  // The word setter must be an Innocent. Neither the Impostor nor Shadow can be selected.
  return connectedActivePlayers(room).filter(player =>
    canSetWord(room.roles[player.id]) && player.id !== excludedId
  );
}
function selectWordSetter(room, excludedId = null) {
  const candidates = eligibleWordSetters(room, excludedId);
  if (candidates.length) room.wordSetterId = random(candidates).id;
  else if (!findPlayer(room, room.wordSetterId)?.connected) room.wordSetterId = eligibleWordSetters(room)[0]?.id || null;
  return room.wordSetterId;
}
function setWinner(room, role, playerId = null) {
  room.winner = { role, playerId };
  room.phase = "game-over";
}
function evaluateTeamVictory(room) {
  if (Object.keys(room.roles).length === 0 || room.phase === "lobby" || room.phase === "game-over") return;
  const living = livingRolePlayers(room);
  const impostors = living.filter(player => room.roles[player.id] === "impostor").length;
  const nonImpostors = living.filter(player => room.roles[player.id] !== "impostor").length;
  if (impostors === 0) setWinner(room, "innocents");
  else if (impostors >= nonImpostors) setWinner(room, "impostors");
}

function startClueRound(room, incrementRound = false) {
  if (incrementRound) room.round += 1;
  room.clues = [];
  room.votes = [];
  for (const player of room.players) {
    player.clueDraft = "";
    player.clueSubmitted = false;
  }
  room.phase = "clues";
}

function schedulePhaseTimeout(room) {
  const duration = PHASE_DURATIONS[room.phase];
  if (!duration) {
    if (room.phaseTimer) clearTimeout(room.phaseTimer);
    room.phaseTimer = null;
    room.phaseTimerPhase = room.phase;
    room.phaseDeadline = null;
    return;
  }
  if (room.phaseTimer && room.phaseTimerPhase === room.phase) return;
  if (room.phaseTimer) clearTimeout(room.phaseTimer);
  room.phaseTimer = null;
  room.phaseTimerPhase = room.phase;
  if (!connectedActivePlayers(room).length) {
    room.phaseDeadline = null;
    return;
  }
  room.phaseDeadline = Date.now() + duration;
  room.phaseTimer = setTimeout(() => handlePhaseTimeout(room), duration);
  room.phaseTimer.unref?.();
}

function sendRoom(room) {
  if (!rooms.has(room.code)) return;
  schedulePhaseTimeout(room);
  void database.saveRoom(room);
  io.to(room.code).emit("room:update", publicRoom(room));
  sendPrivateState(room);
}

function resolveVotes(room) {
  if (room.phase !== "voting") return;
  const decision = countVotes(room.votes);
  const eliminatedId = decision.eliminatedId;
  const eliminatedPlayer = eliminatedId ? findPlayer(room, eliminatedId) : null;

  if (eliminatedPlayer && !eliminatedPlayer.eliminated) eliminatedPlayer.eliminated = true;

  const summary = groupVoteCounts(room.votes, room.players);
  const voteResults = {
    id: crypto.randomUUID(),
    votes: room.votes.map(vote => ({
      voterId: vote.voterId,
      voterName: findPlayer(room, vote.voterId)?.name || "Player",
      targetId: vote.targetId || null,
      targetName: vote.targetId ? (findPlayer(room, vote.targetId)?.name || "Player") : "Skipped",
      skipped: !vote.targetId
    })),
    groupedCounts: summary.groups,
    skippedCount: summary.skipped,
    eliminatedId: eliminatedPlayer?.id || null,
    eliminatedName: eliminatedPlayer?.name || null,
    eliminatedRole: eliminatedPlayer ? room.roles[eliminatedPlayer.id] : null,
    tied: decision.tied,
    noVotes: summary.groups.length === 0
  };
  room.lastVoteResults = voteResults;

  if (eliminatedPlayer && room.roles[eliminatedPlayer.id] === "shadow") {
    setWinner(room, "shadow", eliminatedPlayer.id);
  } else {
    evaluateTeamVictory(room);
  }

  io.to(room.code).emit("game:vote-results", voteResults);
  if (room.winner) {
    sendRoom(room);
    return;
  }
  startClueRound(room, true);
  advanceAfterActions(room);
}

function advanceAfterActions(room) {
  if (room.phase !== "lobby" && room.phase !== "game-over") {
    const connectedCount = connectedActivePlayers(room).length;
    if (connectedCount < 2) {
      if (room.phase !== "waiting") room.waitingPhase = room.phase;
      room.phase = "waiting";
      sendRoom(room);
      return;
    }
    if (room.phase === "waiting") {
      room.phase = room.waitingPhase || "clues";
      room.waitingPhase = null;
    }
    if (room.phase === "word-entry" && !eligibleWordSetters(room).length) {
      room.waitingPhase = "word-entry";
      room.phase = "waiting";
      sendRoom(room);
      return;
    }
    if (room.phase === "word-entry" && !findPlayer(room, room.wordSetterId)?.connected) selectWordSetter(room);
  }
  if (room.phase === "ready" && connectedActivePlayers(room).length > 0
      && connectedActivePlayers(room).every(player => player.ready)) {
    startClueRound(room);
  } else if (room.phase === "clues" && connectedActivePlayers(room).length > 0
      && connectedActivePlayers(room).every(player => player.clueSubmitted)) {
    room.phase = "voting";
  } else if (room.phase === "voting" && connectedActivePlayers(room).length > 0
      && connectedActivePlayers(room).every(player => room.votes.some(vote => vote.voterId === player.id))) {
    resolveVotes(room);
    return;
  }
  sendRoom(room);
}

function handlePhaseTimeout(room) {
  room.phaseTimer = null;
  room.phaseDeadline = null;
  if (!rooms.has(room.code)) return;
  const participants = connectedActivePlayers(room);
  if (!participants.length) {
    room.phaseTimerPhase = null;
    return;
  }

  if (room.phase === "word-entry") {
    const previousSetter = room.wordSetterId;
    selectWordSetter(room, previousSetter);
    room.phaseTimerPhase = null;
    io.to(room.code).emit("game:notice", {
      message: room.wordSetterId && room.wordSetterId !== previousSetter
        ? "The word setter timed out. A new Innocent was selected."
        : "The word setter needs more time. The entry timer has restarted."
    });
    sendRoom(room);
    return;
  }

  if (room.phase === "ready") {
    for (const player of participants) player.ready = true;
    io.to(room.code).emit("game:notice", { message: "The ready timer ended. The clue round is starting." });
    advanceAfterActions(room);
    return;
  }

  if (room.phase === "clues") {
    for (const player of participants) {
      if (player.clueSubmitted) continue;
      const text = player.clueDraft.trim().slice(0, 120) || "No clue submitted.";
      player.clueDraft = text;
      player.clueSubmitted = true;
      room.clues = room.clues.filter(clue => clue.playerId !== player.id);
      room.clues.push({ playerId: player.id, text });
    }
    io.to(room.code).emit("game:notice", { message: "Time is up. Missing clues were marked automatically." });
    advanceAfterActions(room);
    return;
  }

  if (room.phase === "voting") {
    for (const player of participants) {
      if (!room.votes.some(vote => vote.voterId === player.id)) {
        room.votes.push({ voterId: player.id, targetId: null, skipped: true });
      }
    }
    io.to(room.code).emit("game:notice", { message: "Voting time is up. Missing votes were counted as skips." });
    resolveVotes(room);
  }
}

function makePlayer(name, socket, token) {
  return {
    id: crypto.randomUUID(),
    tokenHash: tokenHash(token),
    socketId: socket.id,
    name: String(name || "Player").trim().replace(/\s+/g, " ").slice(0, 20) || "Player",
    connected: true,
    eliminated: false,
    voiceEnabled: false,
    position: null,
    lastWorldMoveAt: 0,
    ready: false,
    clueDraft: "",
    clueSubmitted: false
  };
}

function removePlayer(room, player) {
  room.players = room.players.filter(candidate => candidate.id !== player.id);
  delete room.roles[player.id];
  room.votes = room.votes.filter(vote => vote.voterId !== player.id && vote.targetId !== player.id);
  room.clues = room.clues.filter(clue => clue.playerId !== player.id);
  if (room.hostId === player.id) {
    room.hostId = room.players.find(candidate => candidate.connected)?.id || room.players[0]?.id || null;
  }
  if (room.wordSetterId === player.id && room.phase === "word-entry") selectWordSetter(room);
}

function scheduleRoomCleanup(room) {
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  if (room.players.some(player => player.connected)) return;
  room.cleanupTimer = setTimeout(() => {
    if (!room.players.some(player => player.connected)) {
      clearRoomTimers(room);
      rooms.delete(room.code);
      void database.deleteRoom(room.code);
    }
  }, ROOM_IDLE_TTL);
  room.cleanupTimer.unref?.();
}

io.on("connection", socket => {
  socket.on("room:create", (payload = {}, callback) => {
    if (!rateLimit(socket, "room-create", 3, 60_000)) {
      return ack(callback, { ok: false, error: "Too many room requests. Try again in a minute." });
    }
    const maxPlayers = Math.max(3, Math.min(MAX_PLAYERS, Math.floor(Number(payload.maxPlayers) || 8)));
    const shadowEnabled = payload.shadowEnabled === true;
    const maxImpostors = maxBalancedImpostors(maxPlayers, shadowEnabled);
    const impostors = Math.max(1, Math.min(4, Math.floor(Number(payload.impostors) || 1), maxImpostors));
    const token = crypto.randomBytes(32).toString("hex");
    const player = makePlayer(payload.name, socket, token);
    player.position = spawnPosition(0, maxPlayers);
    let code = roomCode();
    while (rooms.has(code)) code = roomCode();
    const room = {
      code,
      hostId: player.id,
      players: [player],
      phase: "lobby",
      phaseTimer: null,
      phaseTimerPhase: "lobby",
      phaseDeadline: null,
      cleanupTimer: null,
      round: 0,
      settings: { maxPlayers, impostors, shadowEnabled },
      roles: {},
      word: null,
      wordSetterId: null,
      clues: [],
      votes: [],
      winner: null,
      lastVoteResults: null,
      waitingPhase: null,
      chatHistory: []
    };
    rooms.set(code, room);
    socket.join(code);
    ack(callback, { ok: true, code, token });
    sendRoom(room);
  });

  socket.on("room:join", (payload = {}, callback) => {
    if (!rateLimit(socket, "room-join", 8, 60_000)) {
      return ack(callback, { ok: false, error: "Too many room attempts. Wait a moment and try again." });
    }
    const code = String(payload.code || "").trim().toUpperCase();
    if (!/^[A-F0-9]{6}$/.test(code)) return ack(callback, { ok: false, error: "Enter a valid six-character room code." });
    const room = rooms.get(code);
    if (!room) return ack(callback, { ok: false, error: "Room not found." });
    if (room.phase !== "lobby") return ack(callback, { ok: false, error: "This match has already started." });
    if (room.players.length >= room.settings.maxPlayers) return ack(callback, { ok: false, error: "Room is full. Ask the host to remove an offline player." });
    const token = crypto.randomBytes(32).toString("hex");
    const player = makePlayer(payload.name, socket, token);
    player.position = spawnPosition(room.players.length, room.settings.maxPlayers);
    room.players.push(player);
    socket.join(code);
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
    ack(callback, { ok: true, code, token });
    sendRoom(room);
  });

  socket.on("room:rejoin", (payload = {}, callback) => {
    if (!rateLimit(socket, "room-rejoin", 8, 60_000)) {
      return ack(callback, { ok: false, error: "Too many reconnect attempts. Try again shortly." });
    }
    const code = String(payload.code || "").trim().toUpperCase();
    const token = String(payload.token || "");
    if (!/^[A-F0-9]{6}$/.test(code) || token.length < 32 || token.length > 128) {
      return ack(callback, { ok: false, error: "The saved room session is invalid." });
    }
    const room = rooms.get(code);
    const supplied = tokenHash(token);
    const player = room?.players.find(candidate => candidate.tokenHash.length === supplied.length
      && crypto.timingSafeEqual(candidate.tokenHash, supplied));
    if (!room || !player) return ack(callback, { ok: false, error: "This saved room session is no longer available." });

    const previousSocketId = player.socketId;
    player.socketId = socket.id;
    player.connected = true;
    player.voiceEnabled = false;
    socket.join(code);
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
    if (previousSocketId && previousSocketId !== socket.id) io.sockets.sockets.get(previousSocketId)?.disconnect(true);
    if (!room.players.some(candidate => candidate.connected && candidate.id === room.hostId)) room.hostId = player.id;
    ack(callback, { ok: true, code, name: player.name });
    advanceAfterActions(room);
  });

  socket.on("room:leave", callback => {
    const room = findRoomForSocket(socket.id);
    const player = room && findPlayerForSocket(room, socket.id);
    if (!room || !player) return ack(callback, { ok: false, error: "Room not found." });
    socket.leave(room.code);
    removePlayer(room, player);
    evaluateTeamVictory(room);
    if (room.players.length === 0) {
      clearRoomTimers(room);
      rooms.delete(room.code);
      void database.deleteRoom(room.code);
      return ack(callback, { ok: true });
    }
    advanceAfterActions(room);
    scheduleRoomCleanup(room);
    ack(callback, { ok: true });
  });

  socket.on("room:update-settings", (payload = {}, callback) => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.phase !== "lobby") return ack(callback, { ok: false, error: "Settings can only change in the lobby." });
    if (room.hostId !== findPlayerForSocket(room, socket.id)?.id) return ack(callback, { ok: false, error: "Only the host can change settings." });
    const maxPlayers = Math.max(3, Math.min(MAX_PLAYERS, Math.floor(Number(payload.maxPlayers) || room.settings.maxPlayers)));
    if (maxPlayers < room.players.length) return ack(callback, { ok: false, error: "Player limit is below the current room size." });
    const shadowEnabled = payload.shadowEnabled === true;
    const maxImpostors = maxBalancedImpostors(maxPlayers, shadowEnabled);
    const impostors = Math.max(1, Math.min(4, Math.floor(Number(payload.impostors) || room.settings.impostors), maxImpostors));
    room.settings = { maxPlayers, impostors, shadowEnabled };
    sendRoom(room);
    ack(callback, { ok: true });
  });

  socket.on("game:start", callback => {
    const room = findRoomForSocket(socket.id);
    const host = room && findPlayerForSocket(room, socket.id);
    if (!room || room.phase !== "lobby") return ack(callback, { ok: false, error: "The room is not in the lobby." });
    if (room.hostId !== host?.id) return ack(callback, { ok: false, error: "Only the host can start the match." });
    const connectedPlayers = connectedActivePlayers(room);
    if (connectedPlayers.length < 3) return ack(callback, { ok: false, error: "At least 3 connected players are required." });
    if (room.players.some(player => !player.connected)) {
      return ack(callback, { ok: false, error: "Remove offline lobby players before starting so every role belongs to an active player." });
    }
    const players = connectedPlayers;
    const actualMaxImpostors = maxBalancedImpostors(players.length, room.settings.shadowEnabled);
    if (room.settings.impostors > actualMaxImpostors) {
      return ack(callback, { ok: false, error: `With ${players.length} connected players, use no more than ${actualMaxImpostors} Impostor(s) to keep the match winnable.` });
    }

    for (const player of players) player.ready = false;
    let assignment;
    try {
      assignment = assignRoles(
        players,
        room.settings.impostors,
        room.settings.shadowEnabled,
        () => crypto.randomInt(0, 1_000_000) / 1_000_000
      );
    } catch (error) {
      return ack(callback, { ok: false, error: error.message || "The role setup is invalid." });
    }
    room.roles = assignment.roles;

    room.word = null;
    room.wordSetterId = assignment.wordSetterId;
    room.round = 1;
    room.clues = [];
    room.votes = [];
    room.winner = null;
    room.lastVoteResults = null;
    room.phase = "word-entry";
    sendRoom(room);
    ack(callback, { ok: true });
  });

  socket.on("word:submit", (payload = {}, callback) => {
    const room = findRoomForSocket(socket.id);
    const player = room && findPlayerForSocket(room, socket.id);
    if (!room || room.phase !== "word-entry") return ack(callback, { ok: false, error: "Word selection is closed." });
    if (room.wordSetterId !== player?.id || !canSetWord(room.roles[player.id])) {
      return ack(callback, { ok: false, error: "Only the selected Innocent can submit the word." });
    }
    const word = String(payload.word || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (word.length < 2) return ack(callback, { ok: false, error: "Word must have at least 2 characters." });
    room.word = word.toUpperCase();
    room.phase = "ready";
    for (const active of room.players) active.ready = false;
    sendRoom(room);
    ack(callback, { ok: true });
  });

  socket.on("word:reselect", callback => {
    const room = findRoomForSocket(socket.id);
    const host = room && findPlayerForSocket(room, socket.id);
    if (!room || room.phase !== "word-entry" || room.hostId !== host?.id) {
      return ack(callback, { ok: false, error: "Only the host can reselect the setter during word entry." });
    }
    if (findPlayer(room, room.wordSetterId)?.connected) {
      return ack(callback, { ok: false, error: "The selected word setter is still connected." });
    }
    if (!selectWordSetter(room)) return ack(callback, { ok: false, error: "No connected Innocent is available to set the word." });
    sendRoom(room);
    ack(callback, { ok: true });
  });

  socket.on("player:ready", (payload = {}, callback) => {
    const room = findRoomForSocket(socket.id);
    const player = room && findPlayerForSocket(room, socket.id);
    if (!room || room.phase !== "ready") return ack(callback, { ok: false, error: "The ready phase is closed." });
    if (!player || player.eliminated) return ack(callback, { ok: false, error: "You are not active in this match." });
    player.ready = payload.ready !== false;
    advanceAfterActions(room);
    ack(callback, { ok: true });
  });

  socket.on("clue:draft", (payload = {}, callback) => {
    if (!rateLimit(socket, "clue-draft", 30, 5_000)) {
      return ack(callback, { ok: false, error: "You are typing too quickly. Wait a moment and try again." });
    }
    const room = findRoomForSocket(socket.id);
    const player = room && findPlayerForSocket(room, socket.id);
    if (!room || room.phase !== "clues") return ack(callback, { ok: false, error: "Clue submission is closed." });
    if (!player || player.eliminated || player.clueSubmitted) return ack(callback, { ok: false, error: "Your clue is locked." });
    player.clueDraft = String(payload.text ?? "").slice(0, 120);
    ack(callback, { ok: true });
  });

  socket.on("clue:submit", (payload = {}, callback) => {
    const room = findRoomForSocket(socket.id);
    const player = room && findPlayerForSocket(room, socket.id);
    if (!room || room.phase !== "clues") return ack(callback, { ok: false, error: "Clue submission is closed." });
    if (!player || player.eliminated) return ack(callback, { ok: false, error: "You are not active in this match." });
    if (player.clueSubmitted) return ack(callback, { ok: false, error: "Your clue is already locked." });
    const text = String(payload.text ?? player.clueDraft).trim().slice(0, 120);
    if (!text) return ack(callback, { ok: false, error: "Write a clue before submitting." });
    player.clueDraft = text;
    player.clueSubmitted = true;
    room.clues = room.clues.filter(clue => clue.playerId !== player.id);
    room.clues.push({ playerId: player.id, text });
    room.lastVoteResults = null;
    advanceAfterActions(room);
    ack(callback, { ok: true });
  });

  socket.on("clue:unsubmit", callback => {
    const room = findRoomForSocket(socket.id);
    const player = room && findPlayerForSocket(room, socket.id);
    if (!room || room.phase !== "clues") return ack(callback, { ok: false, error: "Clue editing is closed." });
    if (!player || player.eliminated) return ack(callback, { ok: false, error: "You are not active in this match." });
    if (!player.clueSubmitted) return ack(callback, { ok: false, error: "Your clue is not submitted." });
    player.clueSubmitted = false;
    room.clues = room.clues.filter(clue => clue.playerId !== player.id);
    sendRoom(room);
    ack(callback, { ok: true });
  });

  socket.on("vote:submit", (payload = {}, callback) => {
    const room = findRoomForSocket(socket.id);
    const player = room && findPlayerForSocket(room, socket.id);
    if (!room || room.phase !== "voting") return ack(callback, { ok: false, error: "Voting has not opened yet." });
    if (!player || player.eliminated) return ack(callback, { ok: false, error: "You are not active in this match." });
    if (room.votes.some(vote => vote.voterId === player.id)) return ack(callback, { ok: false, error: "Your vote is already locked." });
    const target = findPlayer(room, String(payload.targetId || ""));
    if (!target || !target.connected || target.eliminated || target.id === player.id) {
      return ack(callback, { ok: false, error: "Choose another connected, active player." });
    }
    room.votes.push({ voterId: player.id, targetId: target.id, skipped: false });
    advanceAfterActions(room);
    ack(callback, { ok: true });
  });

  socket.on("vote:skip", callback => {
    const room = findRoomForSocket(socket.id);
    const player = room && findPlayerForSocket(room, socket.id);
    if (!room || room.phase !== "voting") return ack(callback, { ok: false, error: "Voting has not opened yet." });
    if (!player || player.eliminated) return ack(callback, { ok: false, error: "You are not active in this match." });
    if (room.votes.some(vote => vote.voterId === player.id)) return ack(callback, { ok: false, error: "Your vote is already locked." });
    room.votes.push({ voterId: player.id, targetId: null, skipped: true });
    advanceAfterActions(room);
    ack(callback, { ok: true });
  });

  socket.on("player:remove-offline", (payload = {}, callback) => {
    const room = findRoomForSocket(socket.id);
    const host = room && findPlayerForSocket(room, socket.id);
    const target = room && findPlayer(room, String(payload.playerId || ""));
    if (!room || room.hostId !== host?.id) return ack(callback, { ok: false, error: "Only the host can remove a player." });
    if (!target || target.connected) return ack(callback, { ok: false, error: "Only offline players can be removed." });
    removePlayer(room, target);
    evaluateTeamVictory(room);
    if (!room.winner && room.phase === "word-entry" && !findPlayer(room, room.wordSetterId)?.connected) selectWordSetter(room);
    advanceAfterActions(room);
    ack(callback, { ok: true });
  });

  socket.on("game:new-match", callback => {
    const room = findRoomForSocket(socket.id);
    const host = room && findPlayerForSocket(room, socket.id);
    if (!room || room.phase !== "game-over" || room.hostId !== host?.id) {
      return ack(callback, { ok: false, error: "Only the host can start a new match after the game ends." });
    }
    for (const player of room.players) {
      player.eliminated = false;
      player.ready = false;
      player.clueDraft = "";
      player.clueSubmitted = false;
    }
    room.roles = {};
    room.word = null;
    room.wordSetterId = null;
    room.round = 0;
    room.clues = [];
    room.votes = [];
    room.winner = null;
    room.lastVoteResults = null;
    room.phase = "lobby";
    room.waitingPhase = null;
    sendRoom(room);
    ack(callback, { ok: true });
  });

  socket.on("world:move", (payload = {}) => {
    if (!rateLimit(socket, "world-move", 20, 1_000)) return;
    const room = findRoomForSocket(socket.id);
    const player = room && findPlayerForSocket(room, socket.id);
    if (!room || !player) return;

    const now = Date.now();
    const elapsedSeconds = player.lastWorldMoveAt
      ? (now - player.lastWorldMoveAt) / 1_000
      : 0.25;
    const position = clampWorldPosition(player.position, payload, elapsedSeconds);
    if (!position) return;

    player.position = position;
    player.lastWorldMoveAt = now;
    if (!room.lastWorldPersistAt || now - room.lastWorldPersistAt >= 5_000) {
      room.lastWorldPersistAt = now;
      void database.saveRoom(room);
    }
    io.to(room.code).emit("world:player-moved", {
      playerId: player.id,
      name: player.name,
      position,
      connected: true,
      voiceEnabled: player.voiceEnabled
    });
  });

  socket.on("chat:send", (payload = {}, callback) => {
    if (!rateLimit(socket, "chat", 8, 5000)) return ack(callback, { ok: false, error: "Slow down a little before sending another message." });
    const room = findRoomForSocket(socket.id);
    const player = room && findPlayerForSocket(room, socket.id);
    const text = String(payload.text || "").trim().slice(0, 300);
    if (!room || !player || !text) return ack(callback, { ok: false, error: "Write a message before sending." });
    const message = {
      id: crypto.randomUUID(),
      playerId: player.id,
      name: player.name,
      text,
      time: new Date().toISOString()
    };
    room.chatHistory.push(message);
    room.chatHistory = room.chatHistory.slice(-50);
    void database.saveRoom(room);
    io.to(room.code).emit("chat:message", message);
    ack(callback, { ok: true });
  });

  socket.on("voice:state", (payload = {}) => {
    if (!rateLimit(socket, "voice-state", 20, 5_000)) return;
    const room = findRoomForSocket(socket.id);
    const player = room && findPlayerForSocket(room, socket.id);
    if (!player) return;
    player.voiceEnabled = payload.enabled === true;
    sendRoom(room);
  });

  socket.on("voice:signal", (payload = {}) => {
    if (!rateLimit(socket, "voice-signal", 500, 10_000)) return;
    const room = findRoomForSocket(socket.id);
    const sender = room && findPlayerForSocket(room, socket.id);
    const target = room?.players.find(player => player.socketId === payload.targetSocketId && player.connected);
    if (!sender || !target || !payload.signal || typeof payload.signal !== "object") return;
    io.to(target.socketId).emit("voice:signal", { fromId: socket.id, signal: payload.signal });
  });

  socket.on("disconnect", () => {
    const room = findRoomForSocket(socket.id);
    const player = room && findPlayerForSocket(room, socket.id);
    if (!room || !player) return;
    player.connected = false;
    player.voiceEnabled = false;
    if (room.hostId === player.id && room.players.some(candidate => candidate.connected)) {
      room.hostId = room.players.find(candidate => candidate.connected).id;
    }
    if (room.phase === "word-entry" && room.wordSetterId === player.id) selectWordSetter(room);
    advanceAfterActions(room);
    scheduleRoomCleanup(room);
  });
});

function restoreRoom(snapshot) {
  if (!snapshot || typeof snapshot.code !== "string" || !Array.isArray(snapshot.players)) return null;
  const players = snapshot.players.map(player => ({
    ...player,
    tokenHash: Buffer.from(String(player.tokenHash || ""), "hex"),
    socketId: null,
    connected: false,
    voiceEnabled: false,
    lastWorldMoveAt: 0
  })).filter(player => player.tokenHash.length === 32);
  return {
    ...snapshot,
    players,
    phaseTimer: null,
    phaseTimerPhase: null,
    phaseDeadline: null,
    cleanupTimer: null,
    lastWorldPersistAt: 0
  };
}

async function startServer() {
  const savedRooms = await database.initializeDatabase();
  for (const snapshot of savedRooms) {
    const room = restoreRoom(snapshot);
    if (!room || !room.players.length) {
      if (snapshot?.code) void database.deleteRoom(snapshot.code);
      continue;
    }
    rooms.set(room.code, room);
    scheduleRoomCleanup(room);
  }
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`MINDTRAP server listening on port ${PORT}`);
    console.log(`Restored ${rooms.size} room(s) from persistent storage.`);
  });
}

if (require.main === module) {
  startServer().catch(error => {
    console.error("MINDTRAP could not initialize its database or server.", error);
    process.exitCode = 1;
  });

  let isShuttingDown = false;
  const shutdown = signal => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`MINDTRAP received ${signal}; closing cleanly.`);
    const forceExit = setTimeout(() => process.exit(1), 12_000);
    forceExit.unref?.();
    server.close(async () => {
      try {
        await database.closeDatabase();
        clearTimeout(forceExit);
        process.exit(0);
      } catch (error) {
        console.error("MINDTRAP shutdown cleanup failed.", error);
        process.exit(1);
      }
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

module.exports = { app, server, io, rooms, PHASE_DURATIONS, personalOutcome, startServer, restoreRoom };
