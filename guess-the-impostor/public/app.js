const socket = io();
const $ = id => document.getElementById(id);
const screens = ["home-screen", "lobby-screen", "game-screen"];
const phasePanels = ["reveal-panel", "clues-panel", "discussion-panel", "voting-panel", "results-panel", "picker-panel", "word-entry-panel", "picker-results-panel"];
let room = null;
let privateInfo = null;
let myRoomCode = null;
let myName = "Player";
let soundOn = true;
let micStream = null;
let micEnabled = false;
let peers = new Map();
let hasVoted = false;
let hasPickerVoted = false;
let musicAudio = null;
const avatarClasses = ["avatar-purple", "avatar-orange", "avatar-blue", "avatar-pink"];
const faces = ["◕‿◕", "ಠ_ಠ", "•ᴗ•", "¬‿¬", "◉ᴗ◉", "ᵔᴥᵔ", "ಠ‿ಠ", "•̀ᴗ•́"];
const SFX = {
  start: "/assets/audio/start.mp3",
  turn: null,
  vote: null,
  result: "/assets/audio/result.mp3"
};

function avatar(id, extra = "") {
  const n = [...String(id || "x")].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return `<div class="avatar ${avatarClasses[n % avatarClasses.length]} ${extra}"><span class="avatar-face">${faces[n % faces.length]}</span><i></i></div>`;
}
function showScreen(id) { screens.forEach(screen => $(screen).classList.toggle("active", screen === id)); }
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2800);
}
function modal(content) { $("modal-content").innerHTML = content; $("modal").classList.remove("hidden"); }
function closeModal() { $("modal").classList.add("hidden"); }
function emitAck(event, data) {
  return new Promise(resolve => {
    const timeout = setTimeout(() => resolve({ ok: false, error: "Server did not respond. Check your connection." }), 8000);
    const done = result => {
      clearTimeout(timeout);
      resolve(result || { ok: true });
    };
    // Socket.IO callback-only events must not receive an empty object before the callback.
    if (data === undefined || data === null) socket.emit(event, done);
    else socket.emit(event, data, done);
  });
}
function getMe() { return room?.players.find(player => player.id === socket.id); }
function isHost() { return room?.hostId === socket.id; }
function activePlayers() { return (room?.players || []).filter(player => player.connected && !player.eliminated); }
function setButtonHostHint(buttonId, hintId, message) {
  $(buttonId).disabled = !isHost();
  $(hintId).classList.toggle("hidden", isHost());
  $(hintId).textContent = message;
}
function playSfx(name) {
  const file = SFX[name];
  if (!soundOn || !file) return;
  const audio = new Audio(file);
  audio.volume = 0.55;
  audio.play().catch(() => {});
}

$("open-create").onclick = () => modal(`
  <div class="eyebrow">NEW GAME</div><h2>Bring your crew.</h2>
  <label>YOUR NAME<input id="create-name" maxlength="20" placeholder="Your nickname" value="${escapeHtml(myName)}"></label>
  <label>PLAYER LIMIT<select id="create-max"><option value="4">4 players</option><option value="8" selected>8 players</option><option value="10">10 players</option><option value="12">12 players</option><option value="15">15 players</option></select></label>
  <label>IMPOSTORS<select id="create-impostors"><option value="1">1 impostor</option><option value="2">2 impostors</option><option value="3">3 impostors</option><option value="4">4 impostors</option></select></label>
  <button id="create-submit" class="primary-button full">Create room <span>→</span></button>`);
$("open-join").onclick = () => modal(`
  <div class="eyebrow">JOIN GAME</div><h2>Enter the room.</h2>
  <label>YOUR NAME<input id="join-name" maxlength="20" placeholder="Your nickname" value="${escapeHtml(myName)}"></label>
  <label>ROOM CODE<input id="join-code" maxlength="6" placeholder="ABC123" style="text-transform:uppercase;letter-spacing:4px"></label>
  <button id="join-submit" class="primary-button full">Join room <span>→</span></button>`);
$("close-modal").onclick = closeModal;
$("modal").onclick = event => { if (event.target === $("modal")) closeModal(); };
$("modal-content").addEventListener("click", async event => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.id === "create-submit") {
    myName = $("create-name").value.trim() || "Player";
    button.disabled = true;
    const result = await emitAck("room:create", { name: myName, maxPlayers: +$("create-max").value, impostors: +$("create-impostors").value });
    button.disabled = false;
    if (!result.ok) return toast(result.error || "Couldn't create room.");
    myRoomCode = result.code;
    closeModal();
    toast("Room created. Invite your friends.");
  }
  if (button.id === "join-submit") {
    myName = $("join-name").value.trim() || "Player";
    const code = $("join-code").value.trim().toUpperCase();
    button.disabled = true;
    const result = await emitAck("room:join", { name: myName, code });
    button.disabled = false;
    if (!result.ok) return toast(result.error || "Couldn't join room.");
    myRoomCode = result.code;
    closeModal();
    toast("Joined the room.");
  }
});

$("copy-code").onclick = async () => {
  try { await navigator.clipboard.writeText(myRoomCode); toast("Room code copied."); }
  catch { toast(`Room code: ${myRoomCode}`); }
};
$("leave-room").onclick = () => {
  closeAllPeers();
  socket.disconnect();
  location.reload();
};
$("start-game").onclick = async () => {
  const result = await emitAck("game:start");
  if (!result.ok) toast(result.error || "Couldn't start the game.");
};
$("max-players").addEventListener("change", updateSettings);
$("impostor-count").addEventListener("change", updateSettings);
async function updateSettings() {
  const result = await emitAck("room:update-settings", { maxPlayers: +$("max-players").value, impostors: +$("impostor-count").value });
  if (!result.ok) toast(result.error || "Couldn't update settings.");
}
$("ready-clues").onclick = async () => {
  if (!isHost()) return toast("Waiting for the host to begin the clue round.");
  const result = await emitAck("game:begin-clues");
  if (!result.ok) toast(result.error || "Couldn't start clues.");
};
$("submit-clue").onclick = submitClue;
$("clue-input").addEventListener("keydown", event => { if (event.key === "Enter") submitClue(); });
async function submitClue() {
  const result = await emitAck("clue:submit", { text: $("clue-input").value });
  if (!result.ok) return toast(result.error || "Couldn't send clue.");
  $("clue-input").value = "";
  $("clue-form").classList.add("hidden");
}
$("open-voting").onclick = async () => {
  const result = await emitAck("discussion:start-vote");
  if (!result.ok) toast(result.error || "Only the host can start voting.");
};
$("next-step").onclick = async () => {
  if (!isHost()) return toast("Waiting for the host.");
  const result = await emitAck("round:next");
  if (!result.ok) toast(result.error || "Couldn't continue.");
};
$("start-next-round").onclick = async () => {
  if (!isHost()) return toast("Waiting for the host.");
  const result = await emitAck("round:next");
  if (!result.ok) toast(result.error || "Couldn't start the next round.");
};
$("submit-word").onclick = submitWord;
$("word-entry-input").addEventListener("keydown", event => { if (event.key === "Enter") submitWord(); });
$("reassign-word-setter").onclick = async () => {
  const result = await emitAck("word:reselect");
  if (!result.ok) toast(result.error || "Couldn't reassign the word setter.");
  else toast("A new word setter was chosen privately.");
};
async function submitWord() {
  const word = $("word-entry-input").value.trim();
  if (!word) return toast("Type a word first.");
  const result = await emitAck("word:submit", { word });
  if (!result.ok) return toast(result.error || "Couldn't set the word.");
  $("word-entry-input").value = "";
  toast("Secret word submitted.");
}
$("chat-form").onsubmit = async event => {
  event.preventDefault();
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text) return;
  const result = await emitAck("chat:send", { text });
  if (result.ok) input.value = "";
  else toast(result.error || "Message failed.");
};
$("chat-toggle").onclick = () => {
  const hidden = $("chat-panel").classList.toggle("chat-collapsed");
  $("chat-toggle").textContent = hidden ? "Show chat" : "Hide chat";
  $("chat-toggle").setAttribute("aria-expanded", String(!hidden));
};

$("sfx-toggle").onclick = () => {
  soundOn = !soundOn;
  $("sfx-toggle").textContent = soundOn ? "Mute SFX" : "Unmute SFX";
  $("sfx-toggle").title = soundOn ? "Mute sound effects" : "Unmute sound effects";
  $("sfx-toggle").setAttribute("aria-pressed", String(soundOn));
};
$("music-toggle").onclick = async () => {
  if (!musicAudio) {
    musicAudio = new Audio("/assets/audio/background-music.mp3");
    musicAudio.loop = true;
    musicAudio.volume = 0.22;
    musicAudio.addEventListener("error", () => toast("Add background-music.mp3 to public/assets/audio first."), { once: true });
  }
  if (musicAudio.paused) {
    try {
      await musicAudio.play();
      $("music-toggle").textContent = "Music: on";
    } catch {
      toast("Add background-music.mp3 to public/assets/audio first.");
    }
  } else {
    musicAudio.pause();
    $("music-toggle").textContent = "Music: off";
  }
};

socket.on("room:update", data => {
  const previousRoom = room;
  if (previousRoom) {
    if (data.round > previousRoom.round) playSfx("start");
    if (data.phase === "clues" && (previousRoom.phase !== "clues" || previousRoom.currentSpeakerId !== data.currentSpeakerId)) playSfx("turn");
    if (data.phase === "voting" && previousRoom.phase !== "voting") playSfx("vote");
    if (data.phase === "results" && previousRoom.phase !== "results") playSfx("result");
  }
  room = data;
  serverClockOffset = (Number(data.serverNow) || Date.now()) - Date.now();
  myRoomCode = data.code;
  if (data.phase === "lobby") showScreen("lobby-screen");
  else showScreen("game-screen");
  renderRoom();
  renderChatHistory(data.chatHistory || []);
  syncVoicePeers();
});
socket.on("game:private", data => {
  privateInfo = data;
  renderPrivate();
});
socket.on("chat:message", message => appendChatMessage(message));
let hasConnectedOnce = false;
socket.on("connect", () => {
  $("connection-label").textContent = "CONNECTED";
  if (hasConnectedOnce && room) {
    room = null;
    privateInfo = null;
    closeAllPeers();
    showScreen("home-screen");
    toast("Connection restored. Create or rejoin a room.");
  }
  hasConnectedOnce = true;
});
socket.on("disconnect", () => {
  $("connection-label").textContent = "RECONNECTING";
  $("voice-status").textContent = "Connection lost. Rejoin the room after reconnecting.";
  closeAllPeers();
});
socket.on("connect_error", () => {
  $("connection-label").textContent = "CONNECTION ERROR";
});

function renderRoom() {
  if (!room) return;
  $("room-code-title").textContent = room.code;
  $("room-code-copy").textContent = room.code;
  $("game-room-code").textContent = room.code;
  $("round-number").textContent = room.round || 1;
  $("player-count").textContent = `${room.players.length}/${room.settings.maxPlayers}`;
  $("max-players").value = room.settings.maxPlayers;
  $("impostor-count").value = room.settings.impostors;
  $("start-game").disabled = !isHost() || activePlayers().length < 3;
  $("start-game").textContent = isHost() ? "Start game →" : "Waiting for host";
  $("max-players").disabled = !isHost();
  $("impostor-count").disabled = !isHost();
  $("lobby-players").innerHTML = room.players.map(player => `
    <div class="player-tile">${avatar(player.id)}<div><strong>${escapeHtml(player.name)}${player.id === socket.id ? " (you)" : ""}</strong><small>${player.isHost ? "HOST" : player.connected ? "READY" : "OFFLINE"}</small></div><span class="player-ready-dot"></span></div>`).join("");
  $("game-roster").innerHTML = room.players.map(player => `
    <div class="roster-player ${player.eliminated ? "eliminated" : ""}">${avatar(player.id)}<div class="roster-player-info"><strong>${escapeHtml(player.name)}${player.id === socket.id ? " (you)" : ""}</strong><small>${player.isHost ? "Host" : player.eliminated ? "Voted out" : player.connected ? "In game" : "Offline"}</small></div><span class="voice-indicator ${player.voiceEnabled ? "active" : ""}" title="${player.voiceEnabled ? "Mic enabled" : "Mic off"}">${player.voiceEnabled ? "MIC" : ""}</span></div>`).join("");
  $("phase-chip").textContent = String(room.phase || "lobby").replaceAll("-", " ").toUpperCase();
  phasePanels.forEach(id => $(id).classList.add("hidden"));
  const panelByPhase = {
    reveal: "reveal-panel", clues: "clues-panel", discussion: "discussion-panel",
    voting: "voting-panel", results: "results-panel", "picker-vote": "picker-panel",
    "word-entry": "word-entry-panel", "picker-results": "picker-results-panel"
  };
  if (panelByPhase[room.phase]) $(panelByPhase[room.phase]).classList.remove("hidden");
  if (room.phase === "lobby") showScreen("lobby-screen");
  else showScreen("game-screen");
  if (room.phase === "clues") renderClues();
  if (room.phase === "discussion") renderDiscussion();
  if (room.phase === "voting") renderVoting();
  if (room.phase === "results") renderResults();
  if (room.phase === "picker-vote") renderPicker();
  if (room.phase === "word-entry") renderWordEntry();
  if (room.phase === "picker-results") renderPickerResults();
  updateTimerUI();
}
function renderPrivate() {
  if (!privateInfo) return;
  $("secret-word").textContent = privateInfo.word || "???";
  $("secret-category").textContent = privateInfo.category || "SECRET";
  $("secret-card").classList.toggle("impostor-card", privateInfo.role === "impostor");
  $("role-note").textContent = privateInfo.role === "impostor"
    ? "You are the IMPOSTOR. Listen carefully and blend in."
    : `You are a regular player. Keep the word secret.${privateInfo.protectedFromImpostor ? " You are protected from being an impostor this round." : ""}`;
  $("secret-word").style.color = privateInfo.role === "impostor" ? "var(--pink)" : "var(--text)";
  $("host-reveal-hint").textContent = isHost() ? "Start the description turns when everyone is ready." : "Waiting for the host to begin the description turns.";
  $("ready-clues").disabled = !isHost();
  $("ready-clues").textContent = isHost() ? "Start description round →" : "Waiting for host";
  if (room?.phase === "word-entry") renderWordEntry();
}
function renderClues() {
  const currentId = room.currentSpeakerId;
  const player = room.players.find(item => item.id === currentId);
  $("clue-round").textContent = room.round;
  const speakerAvatar = $("speaker-avatar");
  const avatarHolder = document.createElement("div");
  avatarHolder.innerHTML = avatar(currentId || "speaker");
  const avatarMarkup = avatarHolder.firstElementChild;
  speakerAvatar.className = avatarMarkup.className;
  speakerAvatar.innerHTML = avatarMarkup.innerHTML;
  $("speaker-name").textContent = player ? player.name : "All clues submitted";
  $("turn-instruction").textContent = currentId === socket.id ? "Your turn. Give one short clue." : `${player ? player.name : "The next player"} is describing the word.`;
  const isMyTurn = currentId === socket.id && !room.clues.some(clue => clue.playerId === socket.id);
  $("clue-form").classList.toggle("hidden", !isMyTurn);
  $("clue-input").disabled = !isMyTurn;
  $("clues-list").innerHTML = room.clues.map(clue => {
    const cluePlayer = room.players.find(item => item.id === clue.playerId);
    return clueMarkup(cluePlayer, clue.text);
  }).join("");
  if (isMyTurn) setTimeout(() => $("clue-input").focus(), 50);
}
function clueMarkup(player, text) {
  if (!player) return "";
  return `<div class="clue-item">${avatar(player.id)}<div><strong>${escapeHtml(player.name)}</strong><p>${escapeHtml(text)}</p></div></div>`;
}
function renderDiscussion() {
  $("discussion-clues").innerHTML = room.clues.map(clue => {
    const player = room.players.find(item => item.id === clue.playerId);
    return clueMarkup(player, clue.text);
  }).join("");
  setButtonHostHint("open-voting", "discussion-host-hint", "The host can start voting early. Otherwise voting starts when the discussion timer ends.");
}
function renderVoting() {
  const me = getMe();
  hasVoted = !!me?.voted;
  $("vote-options").innerHTML = activePlayers().filter(player => player.id !== socket.id).map(player => `
    <button class="vote-option" data-vote="${player.id}" ${hasVoted ? "disabled" : ""}>${avatar(player.id)}<span>${escapeHtml(player.name)}</span></button>`).join("") +
    `<button class="vote-option skip-option" data-vote="skip" ${hasVoted ? "disabled" : ""}><span class="avatar avatar-orange"><span class="avatar-face">↷</span></span><span>Skip vote</span></button>`;
  $("vote-progress").textContent = `${room.voteCount} / ${room.totalVoters} votes`;
  $("vote-options").querySelectorAll("[data-vote]").forEach(button => button.onclick = async () => {
    const result = await emitAck("vote:submit", { targetId: button.dataset.vote });
    if (!result.ok) toast(result.error || "Vote failed.");
    else toast("Vote submitted privately.");
  });
}
function renderResults() {
  const result = room.voteResults || {};
  if (room.winner) {
    $("result-title").textContent = room.winner === "players" ? "IMPOSTOR CAUGHT!" : "IMPOSTORS WIN";
    $("result-copy").textContent = room.winner === "players" ? "The regular players found every impostor." : "The impostors outnumbered the regular players.";
    $("result-card").innerHTML = `<strong>${room.winner === "players" ? "Regular players win!" : "Impostors win!"}</strong><p>This game is over. Create a new room to play again.</p>`;
    $("next-step").classList.add("hidden");
    $("result-host-hint").textContent = "";
    return;
  }
  $("next-step").classList.remove("hidden");
  $("result-title").textContent = result.eliminatedName ? `${escapeHtml(result.eliminatedName)} was voted out` : result.skipped ? "The room skipped" : "The vote was tied";
  $("result-copy").textContent = result.eliminatedName
    ? "The eliminated player stays in the room and can still use chat and voice."
    : result.skipped ? "No one was removed this round." : "No clear majority. No one was removed.";
  $("result-card").innerHTML = result.eliminatedName
    ? `<strong>${escapeHtml(result.eliminatedName)}</strong><p>Role revealed: <b>${result.eliminatedRole === "impostor" ? "IMPOSTOR" : "REGULAR PLAYER"}</b></p>`
    : `<strong>${result.skipped ? "Skip vote" : "Tied votes"}</strong><p>The next phase will choose the next word setter.</p>`;
  setButtonHostHint("next-step", "result-host-hint", "The host continues to the next word-setter vote.");
}
function renderPicker() {
  hasPickerVoted = !!room.players.find(player => player.id === socket.id)?.pickerVoted;
  $("picker-options").innerHTML = activePlayers().map(player => `
    <button class="vote-option" data-picker="${player.id}" ${hasPickerVoted ? "disabled" : ""}>${avatar(player.id)}<span>${escapeHtml(player.name)}${player.id === socket.id ? " (you)" : ""}</span></button>`).join("");
  $("picker-progress").textContent = `${room.pickerVoteCount || 0} / ${room.totalVoters} votes`;
  $("picker-options").querySelectorAll("[data-picker]").forEach(button => button.onclick = async () => {
    const result = await emitAck("word-picker:vote", { targetId: button.dataset.picker });
    if (!result.ok) toast(result.error || "Vote failed.");
    else toast("Vote submitted.");
  });
}
function renderWordEntry() {
  const allowed = !!privateInfo?.isWordPicker;
  $("word-entry-form").classList.toggle("hidden", !allowed || !!room.wordSubmitted);
  $("reassign-word-setter").classList.toggle("hidden", !isHost() || !room.wordSetterUnavailable || !!room.wordSubmitted);
  $("word-entry-hint").textContent = room.wordSetterUnavailable
    ? isHost() ? "The selected setter disconnected. You can choose another setter." : "The selected player disconnected. Waiting for the host to choose another setter."
    : allowed ? room.wordSubmitted ? "Word submitted. Waiting for the host to reveal roles." : "You were selected. Take your time; there is no word-entry timer."
    : "The selected player is choosing a word. Their identity stays hidden.";
  $("word-entry-copy").textContent = allowed
    ? "Type a word. The impostor will not see it."
    : room.wordSetterUnavailable ? "The host can privately reselect the word setter."
    : "A player chosen in secret is entering the word.";
}
function renderPickerResults() {
  $("picker-result-title").textContent = "Next word setter selected";
  $("picker-result-copy").textContent = "The next word setter has been chosen in secret. Their identity will stay hidden, and they cannot be an impostor next round.";
  setButtonHostHint("start-next-round", "picker-host-hint", "The host starts the next round.");
}
function renderChatHistory(messages) {
  const container = $("chat-messages");
  container.innerHTML = "";
  if (!messages.length) {
    const welcome = document.createElement("div");
    welcome.className = "system-message";
    welcome.textContent = "Room chat is live. Eliminated players can still talk.";
    container.append(welcome);
  } else {
    messages.forEach(appendChatMessage);
  }
  container.scrollTop = container.scrollHeight;
}
function appendChatMessage(message) {
  if (!room) return;
  const container = $("chat-messages");
  if (container.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`)) return;
  const div = document.createElement("div");
  div.className = "chat-message";
  div.dataset.messageId = message.id;
  const time = new Date(message.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const name = document.createElement("strong");
  name.textContent = message.name;
  const text = document.createElement("span");
  text.textContent = message.text;
  const timestamp = document.createElement("span");
  timestamp.className = "time";
  timestamp.textContent = time;
  div.append(name, text, timestamp);
  container.append(div);
  while (container.children.length > 50) container.firstElementChild.remove();
  container.scrollTop = container.scrollHeight;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function updateTimerUI() {
  const phasesWithTimer = ["clues", "discussion", "voting", "picker-vote"];
  const active = !!room && phasesWithTimer.includes(room.phase) && !!room.phaseEndsAt;
  $("phase-timer").classList.toggle("hidden", !active);
  if (!active) return;
  const estimatedServerNow = Date.now() + serverClockOffset;
  const secondsLeft = Math.max(0, Math.ceil((room.phaseEndsAt - estimatedServerNow) / 1000));
  const duration = Math.max(1, Number(room.phaseDuration) || 20);
  const elapsedRatio = Math.max(0, Math.min(1, 1 - (secondsLeft / duration)));
  $("timer-countdown").textContent = `00:${String(secondsLeft).padStart(2, "0")}`;
  const labels = { clues: "DESCRIPTION TURN", discussion: "DISCUSSION", voting: "VOTING", "picker-vote": "WORD-SETTER VOTE" };
  $("timer-label").textContent = labels[room.phase] || "TIME LEFT";
  $("timer-fill").style.width = `${elapsedRatio * 100}%`;
  $("phase-timer").classList.toggle("timer-urgent", secondsLeft <= 5);
}
let serverClockOffset = 0;
setInterval(updateTimerUI, 200);

// WebRTC mesh for small private rooms. One side initiates each pair to avoid offer glare.
const defaultIceServers = window.MINDTRAP_CONFIG?.iceServers || [{ urls: "stun:stun.l.google.com:19302" }];
function closeAllPeers() {
  for (const [id, pc] of peers) {
    pc.ontrack = null;
    pc.close();
    document.getElementById(`audio-${id}`)?.remove();
  }
  peers.clear();
}
function sendVoiceSignal(targetId, signal) {
  socket.emit("voice:signal", { targetId, signal });
}
async function enableMic() {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("Microphone needs HTTPS or localhost and a supported browser.");
    return;
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    micEnabled = true;
    micStream.getAudioTracks().forEach(track => { track.enabled = true; });
    $("mic-toggle").textContent = "Mute mic";
    $("mic-toggle").classList.add("mic-on");
    $("voice-status").textContent = "Mic on. Waiting for other players to enable theirs.";
    socket.emit("voice:state", { enabled: true });
    syncVoicePeers();
  } catch (error) {
    console.warn("Microphone access failed", error);
    toast("Allow microphone access in your browser settings.");
    $("voice-status").textContent = "Mic permission blocked or no microphone found.";
  }
}
$("mic-toggle").onclick = async () => {
  if (!micStream) return enableMic();
  micEnabled = !micEnabled;
  micStream.getAudioTracks().forEach(track => { track.enabled = micEnabled; });
  $("mic-toggle").textContent = micEnabled ? "Mute mic" : "Unmute mic";
  $("mic-toggle").classList.toggle("mic-on", micEnabled);
  $("voice-status").textContent = micEnabled ? "Microphone on." : "Microphone muted.";
};

async function syncVoicePeers() {
  if (!room || !micStream || !micEnabled || !socket.id) return;
  const remoteVoicePlayers = room.players.filter(player => player.id !== socket.id && player.connected && player.voiceEnabled);
  for (const player of remoteVoicePlayers) {
    // Only the lexicographically lower socket ID creates the offer for this pair.
    if (socket.id.localeCompare(player.id) < 0) {
      try { await createAndOffer(player.id); }
      catch (error) { console.warn("Could not start voice connection", error); }
    }
  }
  const connectedCount = [...peers.values()].filter(pc => pc.connectionState === "connected").length;
  $("voice-status").textContent = connectedCount
    ? `Mic on · ${connectedCount} player${connectedCount === 1 ? "" : "s"} connected`
    : "Mic on. Waiting for voice connections…";
}
function createPeer(targetId) {
  if (peers.has(targetId)) return peers.get(targetId);
  const pc = new RTCPeerConnection({ iceServers: defaultIceServers, bundlePolicy: "max-bundle" });
  pc._pendingCandidates = [];
  pc._makingOffer = false;
  pc._addedTracks = new Set();
  if (micStream) {
    micStream.getTracks().forEach(track => {
      if (!pc._addedTracks.has(track.id)) {
        pc.addTrack(track, micStream);
        pc._addedTracks.add(track.id);
      }
    });
  }
  pc.onicecandidate = event => { if (event.candidate) sendVoiceSignal(targetId, { candidate: event.candidate }); };
  pc.ontrack = event => {
    let audio = document.getElementById(`audio-${targetId}`);
    if (!audio) {
      audio = document.createElement("audio");
      audio.id = `audio-${targetId}`;
      audio.autoplay = true;
      audio.playsInline = true;
      audio.setAttribute("aria-label", "Room voice audio");
      document.body.append(audio);
    }
    audio.srcObject = event.streams[0];
    audio.play().catch(() => { $("voice-status").textContent = "Tap the page once to allow incoming voice audio."; });
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") $("voice-status").textContent = "Voice connected.";
    if (["failed", "closed"].includes(pc.connectionState)) {
      pc.close();
      peers.delete(targetId);
      document.getElementById(`audio-${targetId}`)?.remove();
      if (pc.connectionState === "failed") $("voice-status").textContent = "Voice connection failed. A TURN server may be needed.";
    }
  };
  peers.set(targetId, pc);
  return pc;
}
async function createAndOffer(targetId) {
  const pc = createPeer(targetId);
  if (pc.signalingState !== "stable" || pc.localDescription || pc._makingOffer) return;
  pc._makingOffer = true;
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendVoiceSignal(targetId, { description: pc.localDescription });
  } finally {
    pc._makingOffer = false;
  }
}
socket.on("voice:signal", async ({ fromId, signal }) => {
  try {
    let pc = peers.get(fromId);
    if (!pc) pc = createPeer(fromId);
    if (signal.description) {
      await pc.setRemoteDescription(signal.description);
      if (signal.description.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendVoiceSignal(fromId, { description: pc.localDescription });
      }
      for (const candidate of pc._pendingCandidates.splice(0)) await pc.addIceCandidate(candidate);
    } else if (signal.candidate) {
      if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate);
      else pc._pendingCandidates.push(signal.candidate);
    }
  } catch (error) {
    console.warn("Voice signaling error", error);
    $("voice-status").textContent = "Voice connection issue. Try turning the mic off and on.";
  }
});
