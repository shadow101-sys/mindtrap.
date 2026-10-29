const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const WORDS = [
  { word: "PIZZA", category: "Food" }, { word: "BASKETBALL", category: "Sports" },
  { word: "BEACH", category: "Places" }, { word: "AIRPLANE", category: "Travel" },
  { word: "TOOTHBRUSH", category: "Everyday things" }, { word: "SCHOOL", category: "Places" },
  { word: "CHOCOLATE", category: "Food" }, { word: "RAIN", category: "Nature" },
  { word: "HEADPHONES", category: "Technology" }, { word: "SPIDER", category: "Animals" },
  { word: "KARAOKE", category: "Activities" }, { word: "MOVIE", category: "Entertainment" },
  { word: "ICE CREAM", category: "Food" }, { word: "ELEVATOR", category: "Everyday things" },
  { word: "VOLCANO", category: "Nature" }, { word: "GUITAR", category: "Music" },
  { word: "HOSPITAL", category: "Places" }, { word: "TIKTOK", category: "Apps" },
  { word: "UMBRELLA", category: "Everyday things" }, { word: "DRAGON", category: "Fantasy" }
];
const random = arr => arr[Math.floor(Math.random() * arr.length)];
const shuffle = arr => [...arr].sort(() => Math.random() - 0.5);
const roomCode = () => crypto.randomBytes(3).toString("hex").toUpperCase();

function publicRoom(room) {
  return {
    code: room.code, hostId: room.hostId, phase: room.phase, round: room.round,
    settings: room.settings,
    players: room.players.map(p => ({
      id: p.id, name: p.name, isHost: p.id === room.hostId,
      connected: p.connected, eliminated: p.eliminated,
      hasClue: room.clues.some(c => c.playerId === p.id),
      voted: room.votes.some(v => v.voterId === p.id),
      pickerVoted: (room.pickerVotes || []).some(v => v.voterId === p.id)
    })),
    speakingOrder: room.speakingOrder,
    currentSpeakerId: room.speakingOrder[room.speakerIndex] || null,
    clues: room.clues.map(c => ({ playerId: c.playerId, text: c.text })),
    voteCount: room.votes.length,
    totalVoters: room.players.filter(p => p.connected && !p.eliminated).length,
    voteResults: room.phase === "results" ? room.voteResults : null,
    winner: room.winner || null,
    wordCategory: room.wordCategory,
    wordSubmitted: !!room.word,
    wordPickerId: room.wordPickerId,
    wordPickerName: room.players.find(p => p.id === room.wordPickerId)?.name || null,
    wordPickerCandidates: room.players.filter(p => p.connected && !p.eliminated).map(p => ({id:p.id,name:p.name}))
  };
}
function sendRoom(room) {
  io.to(room.code).emit("room:update", publicRoom(room));
  room.players.forEach(p => {
    const role = room.roles[p.id];
    if (role) io.to(p.id).emit("game:private", {
      role, word: role === "impostor" ? null : room.word,
      category: room.wordCategory, protectedFromImpostor: room.protectedId === p.id,
      isWordPicker: room.wordPickerId === p.id
    });
  });
}
function findPlayer(room, id) { return room.players.find(p => p.id === id); }
function activePlayers(room) { return room.players.filter(p => p.connected && !p.eliminated); }
function startRound(room) {
  const active = activePlayers(room);
  if (active.length < 3) { room.phase = "lobby"; return; }
  room.round += 1;
  room.phase = "word-entry";
  const eligiblePickers = active.filter(p => p.id !== room.protectedId);
  room.wordPickerId = room.nextWordPickerId && findPlayer(room, room.nextWordPickerId)
    ? room.nextWordPickerId : random(eligiblePickers.length ? eligiblePickers : active).id;
  room.nextWordPickerId = null;
  room.wordPickerId = active.some(p => p.id === room.wordPickerId) ? room.wordPickerId : random(active).id;
  room.word = null;
  room.wordCategory = "Custom word";
  room.roles = {};
  // The chosen word setter must be innocent. Also protect the previously elected player.
  const candidates = active.filter(p => p.id !== room.protectedId && p.id !== room.wordPickerId);
  const eligible = candidates.length >= room.settings.impostors ? candidates : active.filter(p => p.id !== room.wordPickerId);
  shuffle(eligible).slice(0, Math.min(room.settings.impostors, active.length - 1)).forEach(p => room.roles[p.id] = "impostor");
  active.forEach(p => { if (!room.roles[p.id]) room.roles[p.id] = "player"; });
  room.speakingOrder = shuffle(active.map(p => p.id));
  room.speakerIndex = 0;
  room.clues = [];
  room.votes = [];
  room.voteResults = null;
  room.winner = null;
  room.eliminatedThisRound = [];
  sendRoom(room);
}
function evaluateWin(room) {
  const active = activePlayers(room);
  const impostors = active.filter(p => room.roles[p.id] === "impostor");
  const regulars = active.filter(p => room.roles[p.id] !== "impostor");
  if (impostors.length === 0) room.winner = "players";
  else if (impostors.length >= regulars.length) room.winner = "impostors";
  if (room.winner) room.phase = "results";
}
function resolveVotes(room) {
  const counts = {};
  room.votes.forEach(v => { counts[v.targetId] = (counts[v.targetId] || 0) + 1; });
  const max = Math.max(0, ...Object.values(counts));
  const leaders = Object.keys(counts).filter(k => counts[k] === max && max > 0);
  const skipCount = counts.skip || 0;
  const topPlayerCount = leaders.filter(id => id !== "skip").length;
  let eliminated = null;
  if (skipCount >= max && skipCount > 0) {
    eliminated = null;
  } else if (topPlayerCount === 1 && leaders[0] !== "skip") {
    eliminated = findPlayer(room, leaders[0]) || null;
  }
  if (eliminated) {
    eliminated.eliminated = true;
    room.eliminatedThisRound.push(eliminated.id);
  }
  room.voteResults = {
    counts,
    eliminatedId: eliminated?.id || null,
    eliminatedName: eliminated?.name || null,
    eliminatedRole: eliminated ? room.roles[eliminated.id] : null,
    skipped: !eliminated && skipCount > 0,
    tie: !eliminated && skipCount === 0
  };
  evaluateWin(room);
  if (!room.winner) room.phase = "results";
  sendRoom(room);
}

io.on("connection", socket => {
  socket.on("room:create", ({ name, maxPlayers, impostors }, cb = () => {}) => {
    name = String(name || "Player").trim().slice(0, 20);
    maxPlayers = Math.max(3, Math.min(15, Number(maxPlayers) || 8));
    impostors = Math.max(1, Math.min(4, Number(impostors) || 1));
    const code = roomCode();
    const player = { id: socket.id, name, connected: true, eliminated: false };
    const room = {
      code, hostId: socket.id, players: [player], phase: "lobby", round: 0,
      settings: { maxPlayers, impostors }, roles: {}, word: null, wordCategory: null,
      speakingOrder: [], speakerIndex: 0, clues: [], votes: [], voteResults: null,
      protectedId: null, nextWordPickerId: null, wordPickerId: null, winner: null,
      eliminatedThisRound: []
    };
    rooms.set(code, room);
    socket.join(code);
    cb({ ok: true, code });
    sendRoom(room);
  });

  socket.on("room:join", ({ code, name }, cb = () => {}) => {
    code = String(code || "").trim().toUpperCase();
    name = String(name || "Player").trim().slice(0, 20);
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: "Room not found." });
    if (room.players.length >= room.settings.maxPlayers) return cb({ ok: false, error: "Room is full." });
    if (room.phase !== "lobby") return cb({ ok: false, error: "Game already started." });
    const player = { id: socket.id, name, connected: true, eliminated: false };
    room.players.push(player);
    socket.join(code);
    cb({ ok: true, code });
    sendRoom(room);
  });

  socket.on("game:start", cb => {
    const room = [...rooms.values()].find(r => r.players.some(p => p.id === socket.id));
    if (!room) return cb?.({ok:false,error:"Room not found."});
    if (room.hostId !== socket.id) return cb?.({ok:false,error:"Only the host can start."});
    if (room.players.length < 3) return cb?.({ok:false,error:"At least 3 players are required."});
    startRound(room);
    cb?.({ok:true});
  });

  socket.on("word:submit", ({ word }, cb = () => {}) => {
    const room = [...rooms.values()].find(r => r.players.some(p => p.id === socket.id));
    if (!room || room.phase !== "word-entry") return cb({ok:false,error:"Word selection is closed."});
    if (room.wordPickerId !== socket.id) return cb({ok:false,error:"Only the selected word setter can submit the word."});
    if (room.roles[socket.id] === "impostor") return cb({ok:false,error:"An impostor cannot choose the word."});
    word = String(word || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (word.length < 2) return cb({ok:false,error:"Word must have at least 2 characters."});
    room.word = word.toUpperCase();
    room.wordCategory = "Custom word";
    room.phase = "reveal";
    sendRoom(room);
    cb({ok:true});
  });

  socket.on("game:begin-clues", cb => {
    const room = [...rooms.values()].find(r => r.players.some(p => p.id === socket.id));
    if (!room || room.hostId !== socket.id || room.phase !== "reveal") return cb?.({ok:false});
    room.phase = "clues";
    sendRoom(room); cb?.({ok:true});
  });

  socket.on("clue:submit", ({ text }, cb = () => {}) => {
    const room = [...rooms.values()].find(r => r.players.some(p => p.id === socket.id));
    if (!room || room.phase !== "clues") return cb({ok:false,error:"Clue phase is closed."});
    const player = findPlayer(room, socket.id);
    if (!player || player.eliminated) return cb({ok:false,error:"You are not active this round."});
    if (room.clues.some(c => c.playerId === socket.id)) return cb({ok:false,error:"You already gave a clue."});
    const expected = room.speakingOrder[room.speakerIndex];
    if (expected !== socket.id) return cb({ok:false,error:"Wait for your turn."});
    text = String(text || "").trim().slice(0, 120);
    if (!text) return cb({ok:false,error:"Write a clue first."});
    room.clues.push({playerId:socket.id,text});
    room.speakerIndex += 1;
    if (room.speakerIndex >= room.speakingOrder.length) room.phase = "discussion";
    sendRoom(room); cb({ok:true});
  });

  socket.on("discussion:start-vote", cb => {
    const room = [...rooms.values()].find(r => r.players.some(p => p.id === socket.id));
    if (!room || room.hostId !== socket.id || room.phase !== "discussion") return cb?.({ok:false});
    room.phase = "voting"; room.votes = [];
    sendRoom(room); cb?.({ok:true});
  });

  socket.on("vote:submit", ({ targetId }, cb = () => {}) => {
    const room = [...rooms.values()].find(r => r.players.some(p => p.id === socket.id));
    if (!room || room.phase !== "voting") return cb({ok:false,error:"Voting is closed."});
    const player = findPlayer(room, socket.id);
    if (!player || player.eliminated) return cb({ok:false,error:"You can't vote this round."});
    if (room.votes.some(v => v.voterId === socket.id)) return cb({ok:false,error:"You already voted."});
    const valid = targetId === "skip" || activePlayers(room).some(p => p.id === targetId && p.id !== socket.id);
    if (!valid) return cb({ok:false,error:"Invalid vote."});
    room.votes.push({voterId:socket.id,targetId});
    if (room.votes.length >= activePlayers(room).length) resolveVotes(room);
    else sendRoom(room);
    cb({ok:true});
  });

  socket.on("word-picker:vote", ({ targetId }, cb = () => {}) => {
    const room = [...rooms.values()].find(r => r.players.some(p => p.id === socket.id));
    if (!room || room.phase !== "picker-vote") return cb({ok:false,error:"Word-setter voting is closed."});
    if (room.winner) return cb({ok:false,error:"The game is over."});
    if (room.pickerVotes?.some(v => v.voterId === socket.id)) return cb({ok:false,error:"You already voted."});
    if (!activePlayers(room).some(p => p.id === targetId)) return cb({ok:false,error:"Invalid player."});
    room.pickerVotes ||= [];
    room.pickerVotes.push({voterId:socket.id,targetId});
    if (room.pickerVotes.length >= activePlayers(room).length) {
      const counts = {};
      room.pickerVotes.forEach(v => counts[v.targetId] = (counts[v.targetId] || 0) + 1);
      const max = Math.max(...Object.values(counts));
      const tied = Object.keys(counts).filter(k => counts[k] === max);
      room.nextWordPickerId = random(tied);
      room.protectedId = room.nextWordPickerId;
      room.pickerVotes = [];
      room.phase = "picker-results";
    }
    sendRoom(room); cb({ok:true});
  });

  socket.on("round:next", cb => {
    const room = [...rooms.values()].find(r => r.players.some(p => p.id === socket.id));
    if (!room || room.hostId !== socket.id || !["results","picker-results"].includes(room.phase) || room.winner) return cb?.({ok:false,error:"Cannot start next round."});
    if (room.phase === "results") { room.pickerVotes = []; room.phase = "picker-vote"; sendRoom(room); return cb?.({ok:true}); }
    startRound(room); cb?.({ok:true});
  });

  socket.on("chat:send", ({ text }, cb = () => {}) => {
    const room = [...rooms.values()].find(r => r.players.some(p => p.id === socket.id));
    if (!room) return cb({ok:false,error:"Join a room first."});
    const player = findPlayer(room, socket.id);
    text = String(text || "").trim().slice(0, 300);
    if (!player || !text) return cb({ok:false,error:"Empty message."});
    io.to(room.code).emit("chat:message", {id:crypto.randomUUID(), playerId:player.id, name:player.name, text, time:new Date().toISOString()});
    cb({ok:true});
  });

  // WebRTC signaling: media itself is peer-to-peer; server only relays offers/answers/ICE.
  socket.on("voice:signal", ({ targetId, signal }) => {
    if (typeof targetId === "string") io.to(targetId).emit("voice:signal", { fromId:socket.id, signal });
  });

  socket.on("disconnect", () => {
    for (const room of rooms.values()) {
      const player = findPlayer(room, socket.id);
      if (!player) continue;
      player.connected = false;
      if (room.hostId === socket.id) {
        const nextHost = room.players.find(p => p.connected);
        if (nextHost) room.hostId = nextHost.id;
      }
      if (room.players.every(p => !p.connected)) rooms.delete(room.code);
      else sendRoom(room);
    }
  });
});

server.listen(PORT, () => console.log(`Guess the Impostor running at http://localhost:${PORT}`));
