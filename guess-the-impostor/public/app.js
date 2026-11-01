const socket = io();
const $ = id => document.getElementById(id);
const STORAGE_KEY = "mindtrap-session";
const MUTED_KEY = "mindtrap-muted-players";
const AVATAR_COLORS = ["violet", "blue", "orange", "pink", "green"];
let room = null;
let privateInfo = null;
let myName = "Player";
let soundOn = true;
let micStream = null;
let micEnabled = false;
let peers = new Map();
let mutedPlayers = loadMutedPlayers();
let musicAudio = null;
let selectedVoteId = null;
let pendingRejoin = false;
const shownVoteResults = new Set();
const SFX = {
  start: "/assets/audio/start.mp3",
  result: "/assets/audio/result.mp3"
};

function loadSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return saved && typeof saved.code === "string" && typeof saved.token === "string" ? saved : null;
  } catch (error) {
    console.warn("Could not read the saved room session.", error);
    return null;
  }
}
function saveSession(session) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    return true;
  } catch (error) {
    console.warn("Could not save the room session.", error);
    toast("The room is open, but this browser could not save its rejoin token.");
    return false;
  }
}
function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn("Could not clear the saved room session.", error);
  }
}
function loadMutedPlayers() {
  try {
    const saved = JSON.parse(localStorage.getItem(MUTED_KEY) || "[]");
    return new Set(Array.isArray(saved) ? saved.filter(id => typeof id === "string") : []);
  } catch (error) {
    console.warn("Could not read local mute preferences.", error);
    return new Set();
  }
}
function saveMutedPlayers() {
  try {
    localStorage.setItem(MUTED_KEY, JSON.stringify([...mutedPlayers]));
  } catch (error) {
    console.warn("Could not save local mute preferences.", error);
  }
}
function getMe() { return room?.players.find(player => player.socketId === socket.id); }
function isHost() { return room?.hostId === getMe()?.id; }
function connectedPlayers() { return (room?.players || []).filter(player => player.connected && !player.eliminated); }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}
function toast(message) {
  const element = $("toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2800);
}
function emitAck(event, data) {
  return new Promise(resolve => {
    const timeout = setTimeout(() => resolve({
      ok: false,
      error: "The server did not respond. Check your connection."
    }), 8000);
    const done = result => {
      clearTimeout(timeout);
      resolve(result || { ok: true });
    };
    if (data === undefined) socket.emit(event, done);
    else socket.emit(event, data, done);
  });
}
function makeModal(title, content) {
  $("modal-content").innerHTML = `<p class="eyebrow">MINDTRAP</p><h2 id="modal-title">${title}</h2>${content}`;
  $("modal").classList.remove("hidden");
}
function closeModal() { $("modal").classList.add("hidden"); }
function saveAndEnterRoom(result, name) {
  myName = name;
  saveSession({ code: result.code, token: result.token, name });
  closeModal();
  toast("Joined the room.");
}
function createRoomModal() {
  makeModal("Create a room", `
    <form id="create-form" class="modal-form">
      <label>Your name<input id="create-name" maxlength="20" value="${escapeHtml(myName)}" required></label>
      <label>Player limit<select id="create-max">
        <option value="3">3</option><option value="4">4</option><option value="6">6</option>
        <option value="8" selected>8</option><option value="10">10</option><option value="12">12</option><option value="15">15</option>
      </select></label>
      <label>Impostors<select id="create-impostors">
        <option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option>
      </select></label>
      <label class="checkbox-label"><input id="create-shadow" type="checkbox"> Add a Shadow</label>
      <button class="button button-primary full-width" type="submit">Create room</button>
    </form>`);
  $("create-form").onsubmit = async event => {
    event.preventDefault();
    const name = $("create-name").value.trim() || "Player";
    const button = $("create-form").querySelector("button");
    button.disabled = true;
    const result = await emitAck("room:create", {
      name,
      maxPlayers: Number($("create-max").value),
      impostors: Number($("create-impostors").value),
      shadowEnabled: $("create-shadow").checked
    });
    button.disabled = false;
    if (!result.ok) return toast(result.error || "Could not create the room.");
    saveAndEnterRoom(result, name);
  };
}
function joinRoomModal() {
  makeModal("Join a room", `
    <form id="join-form" class="modal-form">
      <label>Your name<input id="join-name" maxlength="20" value="${escapeHtml(myName)}" required></label>
      <label>Room code<input id="join-code" maxlength="6" autocomplete="off" required></label>
      <button class="button button-primary full-width" type="submit">Join room</button>
    </form>`);
  $("join-form").onsubmit = async event => {
    event.preventDefault();
    const name = $("join-name").value.trim() || "Player";
    const button = $("join-form").querySelector("button");
    button.disabled = true;
    const result = await emitAck("room:join", {
      name,
      code: $("join-code").value.trim().toUpperCase()
    });
    button.disabled = false;
    if (!result.ok) return toast(result.error || "Could not join the room.");
    saveAndEnterRoom(result, name);
  };
}

$("open-create").onclick = createRoomModal;
$("open-join").onclick = joinRoomModal;
$("close-modal").onclick = closeModal;
$("modal").onclick = event => { if (event.target === $("modal")) closeModal(); };
$("copy-code").onclick = async () => {
  try {
    await navigator.clipboard.writeText(room?.code || "");
    toast("Room code copied.");
  } catch (error) {
    console.warn("Could not copy the room code.", error);
    toast(`Room code: ${room?.code || ""}`);
  }
};
$("leave-room").onclick = async () => {
  await emitAck("room:leave");
  clearSession();
  closeAllPeers();
  micStream?.getTracks().forEach(track => track.stop());
  micStream = null;
  micEnabled = false;
  room = null;
  privateInfo = null;
  $("room-screen").classList.add("hidden");
  $("home-screen").classList.remove("hidden");
  updateMicButton();
};
$("start-game").onclick = async () => {
  const result = await emitAck("game:start");
  if (!result.ok) toast(result.error || "Could not start the match.");
};
$("new-match").onclick = async () => {
  const result = await emitAck("game:new-match");
  if (!result.ok) toast(result.error || "Could not start a new match.");
};
$("max-players").onchange = updateSettings;
$("impostor-count").onchange = updateSettings;
$("shadow-enabled").onchange = updateSettings;
async function updateSettings() {
  const result = await emitAck("room:update-settings", {
    maxPlayers: Number($("max-players").value),
    impostors: Number($("impostor-count").value),
    shadowEnabled: $("shadow-enabled").checked
  });
  if (!result.ok) toast(result.error || "Could not update the settings.");
}
$("word-entry-form").onsubmit = async event => {
  event.preventDefault();
  const result = await emitAck("word:submit", { word: $("word-input").value });
  if (!result.ok) return toast(result.error || "Could not set the word.");
  $("word-input").value = "";
};
$("word-reselect").onclick = async () => {
  const result = await emitAck("word:reselect");
  if (!result.ok) toast(result.error || "Could not choose another word setter.");
};
$("ready-button").onclick = async () => {
  const result = await emitAck("player:ready", { ready: true });
  if (!result.ok) toast(result.error || "Could not mark you ready.");
};
$("clue-input").addEventListener("input", () => {
  clearTimeout($("clue-input").draftTimer);
  $("clue-input").draftTimer = setTimeout(() => {
    socket.emit("clue:draft", { text: $("clue-input").value });
  }, 250);
});
$("clue-form").onsubmit = async event => {
  event.preventDefault();
  clearTimeout($("clue-input").draftTimer);
  const result = await emitAck("clue:submit", { text: $("clue-input").value });
  if (!result.ok) return toast(result.error || "Could not submit the clue.");
  $("clue-input").disabled = true;
  $("submit-clue").disabled = true;
};
$("confirm-vote").onclick = async () => {
  if (!selectedVoteId) return;
  const result = await emitAck("vote:submit", { targetId: selectedVoteId });
  if (!result.ok) return toast(result.error || "Could not submit the vote.");
  $("confirm-vote").disabled = true;
};
$("chat-form").onsubmit = async event => {
  event.preventDefault();
  const input = $("chat-input");
  if (!input.value.trim()) return;
  const result = await emitAck("chat:send", { text: input.value });
  if (!result.ok) return toast(result.error || "Message failed.");
  input.value = "";
};
$("chat-toggle").onclick = () => {
  const hidden = $("chat-content").classList.toggle("hidden");
  $("chat-toggle").textContent = hidden ? "Show" : "Hide";
  $("chat-toggle").setAttribute("aria-expanded", String(!hidden));
};
$("dismiss-vote-result").onclick = () => $("vote-result-overlay").classList.add("hidden");
$("sfx-toggle").onclick = () => {
  soundOn = !soundOn;
  $("sfx-toggle").textContent = soundOn ? "Mute SFX" : "Unmute SFX";
  $("sfx-toggle").setAttribute("aria-pressed", String(soundOn));
};
$("music-toggle").onclick = async () => {
  if (!musicAudio) {
    musicAudio = new Audio("/assets/audio/background-music.mp3");
    musicAudio.loop = true;
    musicAudio.volume = 0.2;
  }
  if (!musicAudio.paused) {
    musicAudio.pause();
    $("music-toggle").textContent = "Music: off";
    return;
  }
  try {
    await musicAudio.play();
    $("music-toggle").textContent = "Music: on";
  } catch (error) {
    console.warn("Background music could not be played.", error);
    toast("Music could not be played in this browser.");
  }
};

function playSfx(name) {
  if (!soundOn || !SFX[name]) return;
  const audio = new Audio(SFX[name]);
  audio.volume = 0.5;
  audio.play().catch(error => console.warn(`Could not play the ${name} sound.`, error));
}
function avatarMarkup(player) {
  const initial = escapeHtml((player.name || "?").trim().charAt(0).toUpperCase());
  const index = [...String(player.id)].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return `<span class="avatar avatar-${AVATAR_COLORS[index % AVATAR_COLORS.length]}">${initial}</span>`;
}
function renderRoom() {
  if (!room) return;
  $("home-screen").classList.add("hidden");
  $("room-screen").classList.remove("hidden");
  $("room-code-title").textContent = room.code;
  $("room-phase").textContent = room.phase === "game-over" ? "MATCH COMPLETE" : room.phase.toUpperCase();
  $("roster-status").textContent = room.phase === "lobby" ? "LOBBY" : `ROUND ${room.round}`;
  $("player-count").textContent = `${room.players.filter(player => player.connected).length}/${room.settings.maxPlayers}`;
  $("max-players").value = String(room.settings.maxPlayers);
  $("impostor-count").value = String(room.settings.impostors);
  $("shadow-enabled").checked = room.settings.shadowEnabled;

  const host = isHost();
  const inLobby = room.phase === "lobby";
  $("lobby-panel").classList.toggle("hidden", !inLobby);
  $("game-panel").classList.toggle("hidden", inLobby);
  $("host-settings").classList.toggle("hidden", !host);
  $("max-players").disabled = !host;
  $("impostor-count").disabled = !host;
  $("shadow-enabled").disabled = !host;
  $("start-game").classList.toggle("hidden", !host);
  $("start-game").disabled = connectedPlayers().length < 3;
  $("lobby-note").textContent = connectedPlayers().length < 3
    ? "At least 3 players must be connected to start."
    : room.players.some(player => !player.connected)
      ? "Offline players can rejoin, or the host can remove them."
      : "Everyone is here. The host can start the match.";

  $("lobby-player-list").innerHTML = room.players.map(player => `
    <div class="player-card ${player.connected ? "" : "is-offline"}">
      ${avatarMarkup(player)}
      <span class="player-name">${escapeHtml(player.name)}${player.id === room.hostId ? " · Host" : ""}</span>
      <span class="player-status">${player.connected ? "Here" : "Offline"}</span>
    </div>`).join("");
  renderRoster();
  renderChatHistory(room.chatHistory || []);
  renderGamePhase();
  if (room.lastVoteResults && !shownVoteResults.has(room.lastVoteResults.id)) {
    showVoteResults(room.lastVoteResults);
  }
  syncVoicePeers();
}
function renderRoster() {
  $("player-list").innerHTML = room.players.map(player => {
    const micLabel = player.voiceEnabled ? "Mic on" : "Mic off";
    const self = player.socketId === socket.id;
    const muteButton = player.connected && !self
      ? `<button class="button button-quiet button-small" type="button" data-mute="${escapeHtml(player.id)}">${mutedPlayers.has(player.id) ? "Unmute" : "Mute"}</button>`
      : "";
    const removeButton = isHost() && !player.connected
      ? `<button class="button button-quiet button-small" type="button" data-remove-player="${escapeHtml(player.id)}">Remove</button>`
      : "";
    let status = player.connected ? micLabel : "Offline";
    if (room.phase === "ready" && player.connected) status = player.ready ? "Ready" : micLabel;
    if (room.phase === "clues" && player.connected && player.hasSubmittedClue) status = "Clue locked";
    return `<div class="roster-player ${player.eliminated ? "is-eliminated" : ""} ${player.connected ? "" : "is-offline"}">
      ${avatarMarkup(player)}
      <span class="player-name">${escapeHtml(player.name)}${self ? " · You" : ""}</span>
      <span class="player-status">${status}</span>
      <span class="player-controls">${muteButton}${removeButton}</span>
    </div>`;
  }).join("");
  $("player-list").querySelectorAll("[data-mute]").forEach(button => {
    button.onclick = () => {
      const { mute: playerId } = button.dataset;
      if (mutedPlayers.has(playerId)) mutedPlayers.delete(playerId);
      else mutedPlayers.add(playerId);
      saveMutedPlayers();
      applyPeerMuteState();
      renderRoster();
    };
  });
  $("player-list").querySelectorAll("[data-remove-player]").forEach(button => {
    button.onclick = async () => {
      const result = await emitAck("player:remove-offline", { playerId: button.dataset.removePlayer });
      if (!result.ok) toast(result.error || "Could not remove the offline player.");
    };
  });
}
const GAME_STATES = ["word-entry-panel", "ready-panel", "clue-panel", "vote-panel", "game-over-panel"];
function renderGamePhase() {
  if (!room || room.phase === "lobby") return;
  GAME_STATES.forEach(id => $(id).classList.add("hidden"));
  $("round-number").textContent = room.round;
  const privateRole = privateInfo?.role;
  const phaseNames = {
    "word-entry": ["WORD SETTER", "Choose the word"],
    ready: ["YOUR ROLE", "Memorise the word"],
    clues: ["DESCRIPTION", "Leave one clue"],
    voting: ["DISCUSSION + VOTE", "Find the Impostor"],
    "game-over": ["MATCH COMPLETE", "Game over"]
  };
  const [phaseLabel, title] = phaseNames[room.phase] || ["MATCH", "Game"];
  $("phase-label").textContent = phaseLabel;
  $("game-title").textContent = title;

  if (room.phase === "word-entry") {
    $("word-entry-panel").classList.remove("hidden");
    const isSetter = privateInfo?.isWordSetter === true;
    $("word-entry-form").classList.toggle("hidden", !isSetter || room.wordSubmitted);
    $("word-entry-note").textContent = room.wordSetterOffline
      ? "The word setter is offline. The host can choose another."
      : isSetter ? "Only you can see this word. Take your time."
        : "A player is choosing the word. Their identity stays private.";
    $("word-reselect").classList.toggle("hidden", !isHost() || !room.wordSetterOffline);
  } else if (room.phase === "ready") {
    $("ready-panel").classList.remove("hidden");
    const role = privateRole || "innocent";
    $("role-label").textContent = role.toUpperCase();
    $("role-card").dataset.role = role;
    $("secret-word").textContent = role === "impostor" ? "You don't know the word" : privateInfo?.word || "Loading word…";
    $("role-note").textContent = role === "shadow"
      ? "Get voted out to win alone."
      : role === "impostor" ? "Listen to the clues and blend in." : "Keep the word private.";
    const me = room.players.find(player => player.socketId === socket.id);
    $("ready-progress").textContent = `${room.readyCount} of ${room.requiredActions} ready`;
    $("ready-button").disabled = !!me?.ready;
    $("ready-button").textContent = me?.ready ? "Ready ✓" : "I'm ready";
  } else if (room.phase === "clues") {
    $("clue-panel").classList.remove("hidden");
    $("clue-progress").textContent = `${room.clueCount} of ${room.requiredActions} clues submitted`;
    const submitted = !!privateInfo?.hasSubmittedClue;
    $("clue-form").classList.toggle("hidden", submitted);
    $("clue-locked-note").classList.toggle("hidden", !submitted);
    $("clue-input").disabled = submitted;
    $("submit-clue").disabled = submitted;
    $("clues-list").innerHTML = room.players.map(player => `
      <div class="clue-item ${player.hasSubmittedClue ? "is-submitted" : ""}">
        ${avatarMarkup(player)}
        <span>${escapeHtml(player.name)}${player.socketId === socket.id ? " · You" : ""}</span>
        <span class="player-status">${player.hasSubmittedClue ? "Submitted" : player.connected ? "Writing" : "Offline"}</span>
      </div>`).join("");
  } else if (room.phase === "voting") {
    $("vote-panel").classList.remove("hidden");
    $("vote-clues").innerHTML = room.clues.map(clue => {
      const player = room.players.find(candidate => candidate.id === clue.playerId);
      if (!player) return "";
      return `<article class="clue-card"><strong>${escapeHtml(player.name)}</strong><p>${escapeHtml(clue.text)}</p></article>`;
    }).join("");
    const me = room.players.find(player => player.socketId === socket.id);
    const hasVoted = !!privateInfo?.hasVoted;
    $("vote-options").innerHTML = connectedPlayers()
      .filter(player => player.socketId !== socket.id)
      .map(player => `<button class="vote-option ${selectedVoteId === player.id ? "is-selected" : ""}" type="button" data-vote-target="${escapeHtml(player.id)}" ${hasVoted ? "disabled" : ""}>
        ${avatarMarkup(player)}<span>${escapeHtml(player.name)}</span></button>`).join("");
    $("vote-options").querySelectorAll("[data-vote-target]").forEach(button => {
      button.onclick = () => {
        selectedVoteId = button.dataset.voteTarget;
        renderGamePhase();
      };
    });
    $("vote-progress").textContent = `${Math.min(room.voteCount, room.requiredActions)} of ${room.requiredActions} votes submitted`;
    $("confirm-vote").classList.toggle("hidden", hasVoted || !!me?.eliminated);
    $("confirm-vote").disabled = !selectedVoteId;
    const selectedPlayer = room.players.find(player => player.id === selectedVoteId);
    $("confirm-vote").textContent = selectedPlayer ? `Vote for ${selectedPlayer.name}` : "Choose a player to vote";
    $("vote-locked-note").classList.toggle("hidden", !hasVoted);
  } else if (room.phase === "game-over") {
    $("game-over-panel").classList.remove("hidden");
    const winner = room.winner || {};
    $("winner-copy").textContent = winner.role === "shadow"
      ? `${room.players.find(player => player.id === winner.playerId)?.name || "The Shadow"} was voted out and wins alone.`
      : winner.role === "impostors" ? "The Impostors have reached parity with the other players."
        : "All Impostors have been eliminated. The Innocents win.";
    $("new-match").classList.toggle("hidden", !isHost());
    $("new-match-note").textContent = isHost() ? "Start a new match for a new word and new roles." : "Waiting for the host to start a new match.";
  }
}

function renderChatHistory(messages) {
  const container = $("chat-messages");
  container.replaceChildren();
  if (messages.length === 0) {
    const note = document.createElement("p");
    note.className = "system-message";
    note.textContent = "Chat is open to everyone in the room.";
    container.append(note);
  } else {
    messages.forEach(appendChatMessage);
  }
}
function appendChatMessage(message) {
  const container = $("chat-messages");
  if (container.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`)) return;
  const item = document.createElement("article");
  item.className = "chat-message";
  item.dataset.messageId = message.id;
  const author = document.createElement("strong");
  author.textContent = message.name;
  const text = document.createElement("span");
  text.textContent = message.text;
  item.append(author, text);
  container.append(item);
  while (container.children.length > 50) container.firstElementChild.remove();
  container.scrollTop = container.scrollHeight;
}
function showVoteResults(results) {
  if (!results?.id || shownVoteResults.has(results.id)) return;
  shownVoteResults.add(results.id);
  playSfx("result");
  $("vote-result-title").textContent = results.eliminatedName
    ? `${results.eliminatedName} was voted out`
    : results.tied ? "The vote was tied" : "Vote complete";
  const roleLabel = results.eliminatedRole === "impostor" ? "Impostor"
    : results.eliminatedRole === "shadow" ? "Shadow"
      : results.eliminatedRole === "innocent" ? "Innocent" : "";
  $("vote-result-copy").textContent = results.eliminatedName
    ? `Role: ${roleLabel}.`
    : "No one was eliminated. The match continues.";
  $("vote-details").innerHTML = results.votes.map(vote => `
    <div class="vote-reveal-row">
      <span>${escapeHtml(vote.voterName)}</span><span class="vote-arrow">→</span><strong>${escapeHtml(vote.targetName)}</strong>
    </div>`).join("");
  $("vote-result-overlay").classList.remove("hidden");
}

socket.on("room:update", data => {
  const previousRoom = room;
  room = data;
  if (previousRoom && data.round > previousRoom.round) playSfx("start");
  selectedVoteId = data.phase === "voting" ? selectedVoteId : null;
  renderRoom();
});
socket.on("game:private", data => {
  privateInfo = data;
  if (room) renderGamePhase();
});
socket.on("game:vote-results", showVoteResults);
socket.on("chat:message", appendChatMessage);
socket.on("connect", async () => {
  $("connection-label").textContent = "CONNECTED";
  if (pendingRejoin) return;
  const saved = loadSession();
  if (!saved) return;
  pendingRejoin = true;
  const result = await emitAck("room:rejoin", saved);
  pendingRejoin = false;
  if (!result.ok) {
    clearSession();
    room = null;
    privateInfo = null;
    $("room-screen").classList.add("hidden");
    $("home-screen").classList.remove("hidden");
    toast("Your saved room is no longer available. Create or join a room.");
    return;
  }
  myName = result.name || saved.name || "Player";
  if (micEnabled) socket.emit("voice:state", { enabled: true });
  toast("Rejoined your room.");
});
socket.on("disconnect", () => {
  $("connection-label").textContent = "RECONNECTING";
  $("voice-status").textContent = "Connection lost. Rejoining…";
  closeAllPeers();
});
socket.on("connect_error", error => {
  console.warn("Room connection failed.", error);
  $("connection-label").textContent = "CONNECTION ERROR";
});

function updateMicButton() {
  $("mic-toggle").textContent = !micStream ? "Enable mic" : micEnabled ? "Mute mic" : "Unmute mic";
  $("mic-toggle").classList.toggle("is-on", micEnabled);
}
async function toggleMic() {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("Microphone access requires HTTPS or localhost.");
    return;
  }
  if (!micStream) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      });
      micEnabled = true;
      micStream.getAudioTracks().forEach(track => { track.enabled = true; });
      socket.emit("voice:state", { enabled: true });
      updateMicButton();
      $("voice-status").textContent = "Mic on. You can mute any player for yourself.";
      await syncVoicePeers();
    } catch (error) {
      console.warn("Microphone access failed.", error);
      $("voice-status").textContent = "Microphone unavailable. Check browser permissions.";
      toast("Allow microphone access in your browser settings.");
    }
    return;
  }
  micEnabled = !micEnabled;
  micStream.getAudioTracks().forEach(track => { track.enabled = micEnabled; });
  socket.emit("voice:state", { enabled: micEnabled });
  updateMicButton();
  $("voice-status").textContent = micEnabled ? "Mic on." : "Mic muted. You can still hear connected players.";
  if (micEnabled) await syncVoicePeers();
}
$("mic-toggle").onclick = toggleMic;

const iceServers = window.MINDTRAP_CONFIG?.iceServers || [{ urls: "stun:stun.l.google.com:19302" }];
function closePeer(socketId) {
  const peer = peers.get(socketId);
  if (peer) {
    peer.ontrack = null;
    peer.close();
    peers.delete(socketId);
  }
  document.getElementById(`audio-${socketId}`)?.remove();
}
function closeAllPeers() {
  for (const socketId of [...peers.keys()]) closePeer(socketId);
}
function sendVoiceSignal(targetSocketId, signal) {
  socket.emit("voice:signal", { targetSocketId, signal });
}
function applyPeerMuteState() {
  for (const player of room?.players || []) {
    if (!player.socketId) continue;
    const audio = document.getElementById(`audio-${player.socketId}`);
    if (audio) audio.muted = mutedPlayers.has(player.id);
  }
}
async function syncVoicePeers() {
  if (!room || !socket.id || !micStream || !micEnabled) return;
  const desired = new Set(room.players
    .filter(player => player.id !== getMe()?.id && player.connected && player.voiceEnabled)
    .map(player => player.socketId));
  for (const socketId of peers.keys()) {
    if (!desired.has(socketId)) closePeer(socketId);
  }
  for (const player of room.players) {
    if (!desired.has(player.socketId)) continue;
    if (socket.id.localeCompare(player.socketId) < 0) {
      try {
        await createAndOffer(player.socketId);
      } catch (error) {
        console.warn("Could not start the voice connection.", error);
        $("voice-status").textContent = "Voice could not connect. Try turning the mic off and on.";
      }
    }
  }
}
function createPeer(targetSocketId) {
  if (peers.has(targetSocketId)) return peers.get(targetSocketId);
  const peer = new RTCPeerConnection({ iceServers, bundlePolicy: "max-bundle" });
  peer.pendingCandidates = [];
  peer.makingOffer = false;
  if (micStream) micStream.getTracks().forEach(track => peer.addTrack(track, micStream));
  peer.onicecandidate = event => {
    if (event.candidate) sendVoiceSignal(targetSocketId, { candidate: event.candidate });
  };
  peer.ontrack = event => {
    let audio = document.getElementById(`audio-${targetSocketId}`);
    if (!audio) {
      audio = document.createElement("audio");
      audio.id = `audio-${targetSocketId}`;
      audio.autoplay = true;
      audio.playsInline = true;
      audio.setAttribute("aria-label", "Room voice audio");
      document.body.append(audio);
    }
    const player = room?.players.find(candidate => candidate.socketId === targetSocketId);
    audio.muted = !!player && mutedPlayers.has(player.id);
    audio.srcObject = event.streams[0];
    audio.play().catch(error => {
      console.warn("Incoming voice playback was blocked.", error);
      $("voice-status").textContent = "Tap the page to allow incoming voice audio.";
    });
  };
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "connected") $("voice-status").textContent = "Voice connected.";
    if (peer.connectionState === "failed") {
      closePeer(targetSocketId);
      $("voice-status").textContent = "Voice connection failed. A TURN server may be needed.";
    }
  };
  peers.set(targetSocketId, peer);
  return peer;
}
async function createAndOffer(targetSocketId) {
  const peer = createPeer(targetSocketId);
  if (peer.signalingState !== "stable" || peer.localDescription || peer.makingOffer) return;
  peer.makingOffer = true;
  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    sendVoiceSignal(targetSocketId, { description: peer.localDescription });
  } finally {
    peer.makingOffer = false;
  }
}
socket.on("voice:signal", async ({ fromId, signal }) => {
  try {
    const peer = peers.get(fromId) || createPeer(fromId);
    if (signal.description) {
      await peer.setRemoteDescription(signal.description);
      if (signal.description.type === "offer") {
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        sendVoiceSignal(fromId, { description: peer.localDescription });
      }
      for (const candidate of peer.pendingCandidates.splice(0)) await peer.addIceCandidate(candidate);
    } else if (signal.candidate) {
      if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate);
      else peer.pendingCandidates.push(signal.candidate);
    }
  } catch (error) {
    console.warn("Voice signaling failed.", error);
    $("voice-status").textContent = "Voice connection issue. Try reconnecting your mic.";
  }
});

updateMicButton();
