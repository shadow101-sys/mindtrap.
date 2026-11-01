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

// Render environment variables can add TURN servers for stronger voice reliability.
// Example: TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
const turnUrls = String(process.env.TURN_URLS || "").split(",").map(v => v.trim()).filter(Boolean);
const iceServers = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
if (turnUrls.length && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
  iceServers.push({
    urls: turnUrls,
    username: process.env.TURN_USERNAME,
    credential: process.env.TURN_CREDENTIAL
  });
}
app.get("/runtime-config.js", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.type("application/javascript").send(`window.MINDTRAP_CONFIG = ${JSON.stringify({ iceServers })};`);
});
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true, service: "mindtrap" }));

const CLUE_SECONDS = 20;
const DISCUSSION_SECONDS = 60;
const VOTING_SECONDS = 30;
const PICKER_VOTE_SECONDS = 25;

const random = items => items[Math.floor(Math.random() * items.length)];
function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
const roomCode = () => crypto.randomBytes(3).toString("hex").toUpperCase();
function findRoomForSocket(socketId) {
  return [...rooms.values()].find(room => room.players.some(player => player.id === socketId));
}
function findPlayer(room, id) { return room.players.find(player => player.id === id); }
function activePlayers(room) { return room.players.filter(player => player.connected && !player.eliminated); }
function clearPhaseTimer(room) {
  if (room.phaseTimer) clearTimeout(room.phaseTimer);
  room.phaseTimer = null;
  room.phaseEndsAt = null;
}
function schedulePhase(room, phase, seconds, callback) {
  clearPhaseTimer(room);
  room.phase = phase;
  room.phaseEndsAt = Date.now() + seconds * 1000;
  room.phaseTimer = setTimeout(() => {
    room.phaseTimer = null;
    room.phaseEndsAt = null;
    callback();
  }, seconds * 1000);
  room.phaseTimer.unref?.();
}

function publicRoom(room) {
  const pickerPublic = room.phase === "picker-results";
  return {
    code: room.code,
    serverNow: Date.now(),
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    settings: room.settings,
    players: room.players.map(player => ({
      id: player.id,
      name: player.name,
      isHost: player.id === room.hostId,
      connected: player.connected,
      eliminated: player.eliminated,
      voiceEnabled: !!player.voiceEnabled,
      hasClue: room.clues.some(clue => clue.playerId === player.id),
      voted: room.votes.some(vote => vote.voterId === player.id),
      pickerVoted: room.pickerVotes.some(vote => vote.voterId === player.id)
    })),
    speakingOrder: room.speakingOrder,
    speakerIndex: room.speakerIndex,
    currentSpeakerId: room.speakingOrder[room.speakerIndex] || null,
    clues: room.clues.map(clue => ({ playerId: clue.playerId, text: clue.text })),
    voteCount: room.votes.length,
    totalVoters: activePlayers(room).length,
    pickerVoteCount: room.pickerVotes.length,
    phaseEndsAt: room.phaseEndsAt,
    phaseDuration: room.phase === "clues" ? CLUE_SECONDS : room.phase === "discussion" ? DISCUSSION_SECONDS : room.phase === "voting" ? VOTING_SECONDS : room.phase === "picker-vote" ? PICKER_VOTE_SECONDS : null,
    voteResults: room.phase === "results" ? room.voteResults : null,
    winner: room.winner || null,
    wordCategory: room.wordCategory,
    wordSubmitted: !!room.word,
    wordSetterUnavailable: room.phase === "word-entry" && !findPlayer(room, room.wordPickerId)?.connected,
    // Neither the current nor next round's word-setter identity is public.
    chatHistory: room.chatHistory.slice(-50)
  };
}
function sendRoom(room) {
  io.to(room.code).emit("room:update", publicRoom(room));
  for (const player of room.players) {
    const role = room.roles[player.id];
    if (role) {
      io.to(player.id).emit("game:private", {
        role,
        word: role === "impostor" ? null : room.word,
        category: room.wordCategory,
        protectedFromImpostor: room.protectedId === player.id,
        isWordPicker: room.wordPickerId === player.id
      });
    }
  }
}

function clearRoundState(room) {
  room.clues = [];
  room.votes = [];
  room.voteResults = null;
  room.pickerVotes = [];
  room.winner = null;
  room.speakingOrder = [];
  room.speakerIndex = 0;
}

function startRound(room) {
  const active = activePlayers(room);
  if (active.length < 3) {
    clearPhaseTimer(room);
    room.phase = "lobby";
    sendRoom(room);
    return false;
  }

  clearPhaseTimer(room);
  room.round += 1;
  clearRoundState(room);
  room.word = null;
  room.wordCategory = "Custom word";
  room.wordPickerId = room.nextWordPickerId && active.some(player => player.id === room.nextWordPickerId)
    ? room.nextWordPickerId
    : random(active).id;
  room.nextWordPickerId = null;
  // The setter is always regular and is also protected for this round.
  room.protectedId = room.wordPickerId;
  room.roles = {};
  const impostorCandidates = active.filter(player => player.id !== room.wordPickerId);
  const impostorCount = Math.min(room.settings.impostors, impostorCandidates.length);
  for (const player of shuffle(impostorCandidates).slice(0, impostorCount)) {
    room.roles[player.id] = "impostor";
  }
  for (const player of active) {
    if (!room.roles[player.id]) room.roles[player.id] = "player";
  }
  room.speakingOrder = shuffle(active.map(player => player.id));
  room.phase = "word-entry";
  sendRoom(room);
  return true;
}

function startDiscussion(room) {
  schedulePhase(room, "discussion", DISCUSSION_SECONDS, () => startVoting(room));
  sendRoom(room);
}
function startClueTurn(room) {
  if (room.phase !== "clues") return;
  while (room.speakerIndex < room.speakingOrder.length) {
    const speakerId = room.speakingOrder[room.speakerIndex];
    const player = findPlayer(room, speakerId);
    if (player?.connected && !player.eliminated) break;
    room.clues.push({ playerId: speakerId, text: "Missed turn" });
    room.speakerIndex += 1;
  }
  if (room.speakerIndex >= room.speakingOrder.length) return startDiscussion(room);
  schedulePhase(room, "clues", CLUE_SECONDS, () => {
    if (room.phase !== "clues") return;
    const speakerId = room.speakingOrder[room.speakerIndex];
    if (speakerId && !room.clues.some(clue => clue.playerId === speakerId)) {
      room.clues.push({ playerId: speakerId, text: "No clue this turn" });
    }
    room.speakerIndex += 1;
    startClueTurn(room);
    sendRoom(room);
  });
  sendRoom(room);
}
function startClues(room) {
  room.phase = "clues";
  room.speakingOrder = shuffle(activePlayers(room).map(player => player.id));
  room.speakerIndex = 0;
  room.clues = [];
  startClueTurn(room);
}
function startVoting(room) {
  if (room.phase === "results" || room.winner) return;
  room.votes = [];
  schedulePhase(room, "voting", VOTING_SECONDS, () => resolveVotes(room));
  sendRoom(room);
}
function evaluateWin(room) {
  const active = activePlayers(room);
  const impostors = active.filter(player => room.roles[player.id] === "impostor");
  const regulars = active.filter(player => room.roles[player.id] !== "impostor");
  if (impostors.length === 0) room.winner = "players";
  else if (impostors.length >= regulars.length) room.winner = "impostors";
  if (room.winner) clearPhaseTimer(room);
}
function resolveVotes(room) {
  if (room.phase !== "voting") return;
  clearPhaseTimer(room);
  const counts = {};
  for (const vote of room.votes) counts[vote.targetId] = (counts[vote.targetId] || 0) + 1;
  const max = Math.max(0, ...Object.values(counts));
  const leaders = Object.keys(counts).filter(target => counts[target] === max && max > 0);
  let eliminated = null;
  if (leaders.length === 1 && leaders[0] !== "skip") {
    const target = findPlayer(room, leaders[0]);
    if (target && !target.eliminated) {
      target.eliminated = true;
      eliminated = target;
    }
  }
  room.voteResults = {
    counts,
    eliminatedId: eliminated?.id || null,
    eliminatedName: eliminated?.name || null,
    eliminatedRole: eliminated ? room.roles[eliminated.id] : null,
    skipped: leaders.length === 1 && leaders[0] === "skip",
    tie: leaders.length > 1 || leaders.length === 0
  };
  evaluateWin(room);
  room.phase = "results";
  room.phaseEndsAt = null;
  sendRoom(room);
}
function finalizePickerVote(room) {
  if (room.phase !== "picker-vote") return;
  clearPhaseTimer(room);
  const active = activePlayers(room);
  if (!active.length) return;
  const counts = {};
  room.pickerVotes.forEach(vote => counts[vote.targetId] = (counts[vote.targetId] || 0) + 1);
  const max = Math.max(0, ...Object.values(counts));
  const leaders = Object.keys(counts).filter(id => counts[id] === max && max > 0);
  const chosenId = leaders.length ? random(leaders) : random(active).id;
  room.nextWordPickerId = active.some(player => player.id === chosenId) ? chosenId : random(active).id;
  room.pickerVotes = [];
  room.phase = "picker-results";
  room.phaseEndsAt = null;
  sendRoom(room);
}

io.on("connection", socket => {
  socket.on("room:create", (payload = {}, cb = () => {}) => {
    let { name, maxPlayers, impostors } = payload;
    name = String(name || "Player").trim().slice(0, 20) || "Player";
    maxPlayers = Math.max(3, Math.min(15, Number(maxPlayers) || 8));
    impostors = Math.max(1, Math.min(4, Number(impostors) || 1, maxPlayers - 1));
    let code = roomCode();
    while (rooms.has(code)) code = roomCode();
    const room = {
      code,
      hostId: socket.id,
      players: [{ id: socket.id, name, connected: true, eliminated: false, voiceEnabled: false }],
      phase: "lobby",
      round: 0,
      settings: { maxPlayers, impostors },
      roles: {},
      word: null,
      wordCategory: null,
      wordPickerId: null,
      protectedId: null,
      nextWordPickerId: null,
      speakingOrder: [],
      speakerIndex: 0,
      clues: [],
      votes: [],
      pickerVotes: [],
      voteResults: null,
      winner: null,
      phaseEndsAt: null,
      phaseTimer: null,
      chatHistory: []
    };
    rooms.set(code, room);
    socket.join(code);
    cb({ ok: true, code });
    sendRoom(room);
  });

  socket.on("room:join", (payload = {}, cb = () => {}) => {
    const code = String(payload.code || "").trim().toUpperCase();
    const name = String(payload.name || "Player").trim().slice(0, 20) || "Player";
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: "Room not found." });
    if (room.phase !== "lobby") return cb({ ok: false, error: "Game already started." });
    if (room.players.filter(player => player.connected).length >= room.settings.maxPlayers) return cb({ ok: false, error: "Room is full." });
    room.players.push({ id: socket.id, name, connected: true, eliminated: false, voiceEnabled: false });
    socket.join(code);
    cb({ ok: true, code });
    sendRoom(room);
  });

  socket.on("room:update-settings", (payload = {}, cb = () => {}) => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.phase !== "lobby") return cb({ ok: false, error: "Settings can only change in the lobby." });
    if (room.hostId !== socket.id) return cb({ ok: false, error: "Only the host can change settings." });
    const maxPlayers = Math.max(3, Math.min(15, Number(payload.maxPlayers) || room.settings.maxPlayers));
    if (maxPlayers < room.players.filter(player => player.connected).length) return cb({ ok: false, error: "Player limit is below the current room size." });
    const impostors = Math.max(1, Math.min(4, Number(payload.impostors) || room.settings.impostors, maxPlayers - 1));
    room.settings = { maxPlayers, impostors };
    sendRoom(room);
    cb({ ok: true });
  });

  socket.on("game:start", cb => {
    const room = findRoomForSocket(socket.id);
    if (!room) return cb?.({ ok: false, error: "Room not found." });
    if (room.hostId !== socket.id) return cb?.({ ok: false, error: "Only the host can start." });
    if (activePlayers(room).length < 3) return cb?.({ ok: false, error: "At least 3 connected players are required." });
    startRound(room);
    cb?.({ ok: true });
  });

  socket.on("word:submit", (payload = {}, cb = () => {}) => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.phase !== "word-entry") return cb({ ok: false, error: "Word selection is closed." });
    if (room.wordPickerId !== socket.id) return cb({ ok: false, error: "Only the selected word setter can submit the word." });
    if (room.roles[socket.id] === "impostor") return cb({ ok: false, error: "An impostor cannot choose the word." });
    const word = String(payload.word || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (word.length < 2) return cb({ ok: false, error: "Word must have at least 2 characters." });
    room.word = word.toUpperCase();
    room.wordCategory = "Custom word";
    room.phase = "reveal";
    room.phaseEndsAt = null; // Word entry deliberately has no timer.
    sendRoom(room);
    cb({ ok: true });
  });

  socket.on("word:reselect", cb => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.hostId !== socket.id || room.phase !== "word-entry") return cb?.({ ok: false, error: "Only the host can reselect the word setter during word entry." });
    if (findPlayer(room, room.wordPickerId)?.connected) return cb?.({ ok: false, error: "The selected word setter is still connected." });
    const active = activePlayers(room);
    if (active.length < 3) return cb?.({ ok: false, error: "At least 3 connected players are required." });
    room.wordPickerId = random(active).id;
    room.protectedId = room.wordPickerId;
    room.roles = {};
    const candidates = shuffle(active.filter(player => player.id !== room.wordPickerId));
    for (const player of candidates.slice(0, Math.min(room.settings.impostors, candidates.length))) room.roles[player.id] = "impostor";
    for (const player of active) if (!room.roles[player.id]) room.roles[player.id] = "player";
    sendRoom(room);
    cb?.({ ok: true });
  });

  socket.on("game:begin-clues", cb => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.hostId !== socket.id || room.phase !== "reveal") return cb?.({ ok: false, error: "Only the host can begin clues." });
    startClues(room);
    cb?.({ ok: true });
  });

  socket.on("clue:submit", (payload = {}, cb = () => {}) => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.phase !== "clues") return cb({ ok: false, error: "Clue phase is closed." });
    const player = findPlayer(room, socket.id);
    if (!player || player.eliminated || !player.connected) return cb({ ok: false, error: "You are not active this round." });
    if (room.speakingOrder[room.speakerIndex] !== socket.id) return cb({ ok: false, error: "Wait for your turn." });
    if (room.clues.some(clue => clue.playerId === socket.id)) return cb({ ok: false, error: "You already gave a clue." });
    const text = String(payload.text || "").trim().slice(0, 120);
    if (!text) return cb({ ok: false, error: "Write a clue first." });
    clearPhaseTimer(room);
    room.clues.push({ playerId: socket.id, text });
    room.speakerIndex += 1;
    if (room.speakerIndex >= room.speakingOrder.length) startDiscussion(room);
    else startClueTurn(room);
    cb({ ok: true });
  });

  socket.on("discussion:start-vote", cb => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.hostId !== socket.id || room.phase !== "discussion") return cb?.({ ok: false, error: "Only the host can start voting." });
    startVoting(room);
    cb?.({ ok: true });
  });

  socket.on("vote:submit", (payload = {}, cb = () => {}) => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.phase !== "voting") return cb({ ok: false, error: "Voting is closed." });
    const player = findPlayer(room, socket.id);
    if (!player || player.eliminated || !player.connected) return cb({ ok: false, error: "You can't vote this round." });
    if (room.votes.some(vote => vote.voterId === socket.id)) return cb({ ok: false, error: "You already voted." });
    const targetId = String(payload.targetId || "");
    const valid = targetId === "skip" || activePlayers(room).some(target => target.id === targetId && target.id !== socket.id);
    if (!valid) return cb({ ok: false, error: "Invalid vote." });
    room.votes.push({ voterId: socket.id, targetId });
    if (room.votes.length >= activePlayers(room).length) resolveVotes(room);
    else sendRoom(room);
    cb({ ok: true });
  });

  socket.on("word-picker:vote", (payload = {}, cb = () => {}) => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.phase !== "picker-vote") return cb({ ok: false, error: "Word-setter voting is closed." });
    if (room.winner) return cb({ ok: false, error: "The game is over." });
    const voter = findPlayer(room, socket.id);
    if (!voter || voter.eliminated || !voter.connected) return cb({ ok: false, error: "Only active players can vote." });
    if (room.pickerVotes.some(vote => vote.voterId === socket.id)) return cb({ ok: false, error: "You already voted." });
    const targetId = String(payload.targetId || "");
    if (!activePlayers(room).some(player => player.id === targetId)) return cb({ ok: false, error: "Invalid player." });
    room.pickerVotes.push({ voterId: socket.id, targetId });
    if (room.pickerVotes.length >= activePlayers(room).length) finalizePickerVote(room);
    else sendRoom(room);
    cb({ ok: true });
  });

  socket.on("round:next", cb => {
    const room = findRoomForSocket(socket.id);
    if (!room || room.hostId !== socket.id || room.winner) return cb?.({ ok: false, error: "Only the host can continue." });
    if (room.phase === "results") {
      room.pickerVotes = [];
      schedulePhase(room, "picker-vote", PICKER_VOTE_SECONDS, () => finalizePickerVote(room));
      sendRoom(room);
      return cb?.({ ok: true });
    }
    if (room.phase === "picker-results") {
      startRound(room);
      return cb?.({ ok: true });
    }
    cb?.({ ok: false, error: "Cannot start the next round yet." });
  });

  socket.on("chat:send", (payload = {}, cb = () => {}) => {
    const room = findRoomForSocket(socket.id);
    if (!room) return cb({ ok: false, error: "Join a room first." });
    const player = findPlayer(room, socket.id);
    const text = String(payload.text || "").trim().slice(0, 300);
    if (!player || !text) return cb({ ok: false, error: "Empty message." });
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
    cb({ ok: true });
  });

  socket.on("voice:state", (payload = {}) => {
    const room = findRoomForSocket(socket.id);
    if (!room) return;
    const player = findPlayer(room, socket.id);
    if (!player) return;
    player.voiceEnabled = !!payload.enabled;
    sendRoom(room);
  });

  socket.on("voice:signal", (payload = {}) => {
    const room = findRoomForSocket(socket.id);
    const targetId = String(payload.targetId || "");
    if (!room || !findPlayer(room, targetId) || !payload.signal) return;
    io.to(targetId).emit("voice:signal", { fromId: socket.id, signal: payload.signal });
  });

  socket.on("disconnect", () => {
    const room = findRoomForSocket(socket.id);
    if (!room) return;
    const player = findPlayer(room, socket.id);
    if (player) {
      player.connected = false;
      player.voiceEnabled = false;
    }
    if (room.hostId === socket.id) {
      const nextHost = room.players.find(candidate => candidate.connected);
      if (nextHost) room.hostId = nextHost.id;
    }
    if (room.players.every(candidate => !candidate.connected)) {
      clearPhaseTimer(room);
      rooms.delete(room.code);
      return;
    }
    if (room.phase === "clues" && room.speakingOrder[room.speakerIndex] === socket.id) {
      clearPhaseTimer(room);
      if (!room.clues.some(clue => clue.playerId === socket.id)) room.clues.push({ playerId: socket.id, text: "Disconnected" });
      room.speakerIndex += 1;
      startClueTurn(room);
    } else if (room.phase === "voting" && room.votes.length >= activePlayers(room).length) {
      resolveVotes(room);
      return;
    } else if (room.phase === "picker-vote" && room.pickerVotes.length >= activePlayers(room).length) {
      finalizePickerVote(room);
      return;
    }
    sendRoom(room);
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`MINDTRAP server listening on port ${PORT}`));
