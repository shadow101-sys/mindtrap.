const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ["GET", "POST"] },
  pingInterval: 25000,
  pingTimeout: 20000
});
const PORT = Number(process.env.PORT) || 3000;
const rooms = new Map();
const MAX_PLAYERS = 15;

const turnUrls = String(process.env.TURN_URLS || "").split(",").map(value => value.trim()).filter(Boolean);
const iceServers = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
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
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_request, response) => response.json({ ok: true, service: "mindtrap" }));

const random = items => items[Math.floor(Math.random() * items.length)];
function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}
const roomCode = () => crypto.randomBytes(3).toString("hex").toUpperCase();
const tokenHash = token => crypto.createHash("sha256").update(token).digest();

function findRoomForSocket(socketId) {
  return [...rooms.values()].find(room => room.players.some(player => player.socketId === socketId));
}
function findPlayer(room, playerId) {
  return room.players.find(player => player.id === playerId);
}
function findPlayerForSocket(room, socketId) {
  return room.players.find(player => player.socketId === socketId);
}
function activePlayers(room) {
  return room.players.filter(player => !player.eliminated);
}
function connectedActivePlayers(room) {
  return room.players.filter(player => player.connected && !player.eliminated);
}
function ack(callback, result) {
  if (typeof callback === "function") callback(result);
}

function publicRoom(room) {
  const revealClues = room.phase === "voting";
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    settings: room.settings,
    players: room.players.map(player => ({
      id: player.id,
      socketId: player.connected ? player.socketId : null,
      name: player.name,
      isHost: player.id === room.hostId,
      connected: player.connected,
      eliminated: player.eliminated,
      voiceEnabled: player.connected && player.voiceEnabled,
      ready: room.phase === "ready" && player.ready,
      hasSubmittedClue: room.phase === "clues" && player.clueSubmitted
    })),
    readyCount: connectedActivePlayers(room).filter(player => player.ready).length,
    clueCount: connectedActivePlayers(room).filter(player => player.clueSubmitted).length,
    voteCount: room.votes.length,
    requiredActions: connectedActivePlayers(room).length,
    clues: revealClues ? room.clues.map(clue => ({ playerId: clue.playerId, text: clue.text })) : [],
    wordSubmitted: !!room.word,
    wordSetterOffline: room.phase === "word-entry" && !findPlayer(room, room.wordSetterId)?.connected,
    lastVoteResults: room.lastVoteResults,
    winner: room.winner,
    chatHistory: room.chatHistory.slice(-50)
  };
}

function sendPrivateState(room) {
  for (const player of room.players) {
    if (!player.connected || !player.socketId) continue;
    const role = room.roles[player.id] || null;
    io.to(player.socketId).emit("game:private", {
      role,
      word: role === "innocent" || role === "shadow" ? room.word : null,
      isWordSetter: room.wordSetterId === player.id,
      ready: player.ready,
      hasSubmittedClue: player.clueSubmitted,
      hasVoted: room.votes.some(vote => vote.voterId === player.id)
    });
  }
}
function sendRoom(room) {
  io.to(room.code).emit("room:update", publicRoom(room));
  sendPrivateState(room);
}
function eligibleWordSetters(room) {
  return connectedActivePlayers(room).filter(player => room.roles[player.id] !== "impostor");
}
function selectWordSetter(room) {
  const candidates = eligibleWordSetters(room);
  room.wordSetterId = candidates.length ? random(candidates).id : null;
}
function setWinner(room, role, playerId = null) {
  room.winner = { role, playerId };
  room.phase = "game-over";
}
function evaluateTeamVictory(room) {
  if (Object.keys(room.roles).length === 0 || room.phase === "lobby" || room.phase === "game-over") return;
  const living = activePlayers(room);
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
function advanceAfterVotes(room) {
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
function resolveVotes(room) {
  if (room.phase !== "voting") return;
  const counts = {};
  for (const vote of room.votes) counts[vote.targetId] = (counts[vote.targetId] || 0) + 1;
  const highest = Math.max(0, ...Object.values(counts));
  const leaders = Object.keys(counts).filter(playerId => counts[playerId] === highest && highest > 0);
  const eliminatedId = leaders.length === 1 ? leaders[0] : null;
  const eliminatedPlayer = eliminatedId ? findPlayer(room, eliminatedId) : null;

  if (eliminatedPlayer && !eliminatedPlayer.eliminated) {
    eliminatedPlayer.eliminated = true;
  }
  const voteResults = {
    id: crypto.randomUUID(),
    votes: room.votes.map(vote => ({
      voterId: vote.voterId,
      voterName: findPlayer(room, vote.voterId)?.name || "Player",
      targetId: vote.targetId,
      targetName: findPlayer(room, vote.targetId)?.name || "Player"
    })),
    eliminatedId: eliminatedPlayer?.id || null,
    eliminatedName: eliminatedPlayer?.name || null,
    eliminatedRole: eliminatedPlayer ? room.roles[eliminatedPlayer.id] : null,
    tied: leaders.length > 1 || leaders.length === 0
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
  sendRoom(room);
}

function makePlayer(name, socket, token) {
  return {
    id: crypto.randomUUID(),
    tokenHash: tokenHash(token),
    socketId: socket.id,
    name: String(name || "Player").trim().slice(0, 20) || "Player",
    connected: true,
    eliminated: false,
    voiceEnabled: false,
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
function reselectDisconnectedWordSetter(room) {
  if (room.phase !== "word-entry" || findPlayer(room, room.wordSetterId)?.connected) return false;
  selectWordSetter(room);
  return true;
}

io.on("connection", socket => {
  socket.on("room:create", (payload = {}, callback) => {
    const maxPlayers = Math.max(3, Math.min(MAX_PLAYERS, Number(payload.maxPlayers) || 8));
    const shadowEnabled = payload.shadowEnabled === true;
    const maxImpostors = Math.max(1, maxPlayers - (shadowEnabled ? 2 : 1));
    const impostors = Math.max(1, Math.min(4, Number(payload.impostors) || 1, maxImpostors));
    const token = crypto.randomBytes(32).toString("hex");
    const player = makePlayer(payload.name, socket, token);
    let code = roomCode();
    while (rooms.has(code)) code = roomCode();
    const room = {
      code,
      hostId: player.id,
      players: [player],
      phase: "lobby",
      round: 0,
      settings: { maxPlayers, impostors, shadowEnabled },
      roles: {},
      word: null,
      wordSetterId: null,
      clues: [],
      votes: [],
      winner: null,
      lastVoteResults: null,
      chatHistory: []
    };
    rooms.set(code, room);
    socket.join(code);
    ack(callback, { ok: true, code, token });
    sendRoom(room);
  });

  socket.on("room:join", (payload = {}, callback) => {
    const code = String(payload.code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return ack(callback, { ok: false, error: "Room not found." });
    if (room.phase !== "lobby") return ack(callback, { ok: false, error: "This match has already started." });
    if (room.players.length >= room.settings.maxPlayers) return ack(callback, { ok: false, error: "Room is full. Ask the host to remove an offline player." });
    const token = crypto.randomBytes(32).toString("hex");
    const player = makePlayer(payload.name, socket, token);
    room.players.push(player);
    socket.join(code);
    ack(callback, { ok: true, code, token });
    sendRoom(room);
  });

  socket.on("room:rejoin", (payload = {}, callback) => {
    const code = String(payload.code || "").trim().toUpperCase();
    const token = String(payload.token || "");
    const room = rooms.get(code);
    const player = room?.players.find(candidate => {
      const supplied = tokenHash(token);
      return candidate.tokenHash.length === supplied.length
        && crypto.timingSafeEqual(candidate.tokenHash, supplied);
    });
    if (!room || !player) return ack(callback, { ok: false, error: "This saved room session is no longer available." });

    const previousSocketId = player.socketId;
    player.socketId = socket.id;
    player.connected = true;
    player.voiceEnabled = false;
    socket.join(code);
    if (previousSocketId && previousSocketId !== socket.id) {
      io.sockets.sockets.get(previousSocketId)?.disconnect(true);
    }
    if (!room.players.some(candidate => candidate.connected && candidate.id === room.hostId)) {
      room.hostId = player.id;
    }
    ack(callback, { ok: true, code, name: player.name });
    advanceAfterVotes(room);
  });

  socket.on("room:leave", callback => {
    const room = findRoomForSocket(socket.id);
    const player = room && findPlayerForSocket(room, socket.id);
    if (!room || !player) return ack(callback, { ok: false, error: "Room not found." });
    socket.leave(room.code);
    removePlayer(room, player);
    evaluateTeamVictory(room);
    if (room.players.length === 0) {
      rooms.delete(room.code);
      return ack(callback, { ok: true });
    }
    advanceAfterVotes(room);
    ack(callback, { ok: true });
  });

  socket.on("room:update-settings", (payload = {}, callback) => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.phase !== "lobby") return ack(callback, { ok: false, error: "Settings can only change in the lobby." });
    if (room.hostId !== findPlayerForSocket(room, socket.id)?.id) return ack(callback, { ok: false, error: "Only the host can change settings." });
    const maxPlayers = Math.max(3, Math.min(MAX_PLAYERS, Number(payload.maxPlayers) || room.settings.maxPlayers));
    if (maxPlayers < room.players.length) return ack(callback, { ok: false, error: "Player limit is below the current room size." });
    const shadowEnabled = payload.shadowEnabled === true;
    const maxImpostors = Math.max(1, maxPlayers - (shadowEnabled ? 2 : 1));
    const impostors = Math.max(1, Math.min(4, Number(payload.impostors) || room.settings.impostors, maxImpostors));
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
    const players = activePlayers(room);
    if (connectedPlayers.length < 3) return ack(callback, { ok: false, error: "At least 3 connected players are required." });
    if (room.settings.impostors >= players.length - (room.settings.shadowEnabled ? 1 : 0)) {
      return ack(callback, { ok: false, error: "There must be at least one non-Impostor who can set the word." });
    }

    room.roles = {};
    for (const player of players) player.ready = false;
    const shuffled = shuffle(players);
    const shadow = room.settings.shadowEnabled ? random(shuffled) : null;
    if (shadow) room.roles[shadow.id] = "shadow";
    const protectedInnocent = random(connectedPlayers.filter(player => player.id !== shadow?.id));
    const impostorCandidates = shuffle(players.filter(player =>
      player.id !== shadow?.id && player.id !== protectedInnocent.id
    ));
    for (const player of impostorCandidates.slice(0, room.settings.impostors)) {
      room.roles[player.id] = "impostor";
    }
    for (const player of players) {
      if (!room.roles[player.id]) room.roles[player.id] = "innocent";
    }
    room.word = null;
    room.wordSetterId = null;
    room.round = 1;
    room.clues = [];
    room.votes = [];
    room.winner = null;
    room.lastVoteResults = null;
    const wordSetters = connectedPlayers.filter(player => room.roles[player.id] !== "impostor");
    room.wordSetterId = random(wordSetters).id;
    room.phase = "word-entry";
    sendRoom(room);
    ack(callback, { ok: true });
  });

  socket.on("word:submit", (payload = {}, callback) => {
    const room = findRoomForSocket(socket.id);
    const player = room && findPlayerForSocket(room, socket.id);
    if (!room || room.phase !== "word-entry") return ack(callback, { ok: false, error: "Word selection is closed." });
    if (room.wordSetterId !== player?.id) return ack(callback, { ok: false, error: "Only the selected word setter can submit the word." });
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
    if (!reselectDisconnectedWordSetter(room)) {
      return ack(callback, { ok: false, error: "The selected word setter is still connected." });
    }
    sendRoom(room);
    ack(callback, { ok: true });
  });

  socket.on("player:ready", (payload = {}, callback) => {
    const room = findRoomForSocket(socket.id);
    const player = room && findPlayerForSocket(room, socket.id);
    if (!room || room.phase !== "ready") return ack(callback, { ok: false, error: "The ready phase is closed." });
    if (!player || player.eliminated) return ack(callback, { ok: false, error: "You are not active in this match." });
    player.ready = payload.ready !== false;
    advanceAfterVotes(room);
    ack(callback, { ok: true });
  });

  socket.on("clue:draft", (payload = {}, callback) => {
    const room = findRoomForSocket(socket.id);
    const player = room && findPlayerForSocket(room, socket.id);
    if (!room || room.phase !== "clues") return ack(callback, { ok: false, error: "Clue submission is closed." });
    if (!player || player.eliminated || player.clueSubmitted) return ack(callback, { ok: false, error: "Your clue is already locked." });
    player.clueDraft = String(payload.text || "").trim().slice(0, 120);
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
    advanceAfterVotes(room);
    ack(callback, { ok: true });
  });

  socket.on("vote:submit", (payload = {}, callback) => {
    const room = findRoomForSocket(socket.id);
    const player = room && findPlayerForSocket(room, socket.id);
    if (!room || room.phase !== "voting") return ack(callback, { ok: false, error: "Voting has not opened yet." });
    if (!player || player.eliminated) return ack(callback, { ok: false, error: "You are not active in this match." });
    if (room.votes.some(vote => vote.voterId === player.id)) return ack(callback, { ok: false, error: "Your vote is already locked." });
    const target = findPlayer(room, String(payload.targetId || ""));
    if (!target || target.eliminated || target.id === player.id) {
      return ack(callback, { ok: false, error: "Choose another active player." });
    }
    room.votes.push({ voterId: player.id, targetId: target.id });
    advanceAfterVotes(room);
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
    if (!room.winner) reselectDisconnectedWordSetter(room);
    advanceAfterVotes(room);
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
    sendRoom(room);
    ack(callback, { ok: true });
  });

  socket.on("chat:send", (payload = {}, callback) => {
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
    io.to(room.code).emit("chat:message", message);
    ack(callback, { ok: true });
  });

  socket.on("voice:state", (payload = {}) => {
    const room = findRoomForSocket(socket.id);
    const player = room && findPlayerForSocket(room, socket.id);
    if (!player) return;
    player.voiceEnabled = payload.enabled === true;
    sendRoom(room);
  });

  socket.on("voice:signal", (payload = {}) => {
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
    reselectDisconnectedWordSetter(room);
    advanceAfterVotes(room);
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`MINDTRAP server listening on port ${PORT}`));
