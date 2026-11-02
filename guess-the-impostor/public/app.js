const socket = io();
const $ = id => document.getElementById(id);
const STORAGE_KEY = "mindtrap-session";
const MUTED_KEY = "mindtrap-muted-players";
const AVATAR_COLORS = ["violet", "blue", "orange", "pink", "green"];
const GAME_STATES = ["waiting-panel", "word-entry-panel", "ready-panel", "clue-panel", "vote-panel"];
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
let lastGameResultKey = "";
let gameResultDismissed = false;
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
  try { localStorage.removeItem(STORAGE_KEY); }
  catch (error) { console.warn("Could not clear the saved room session.", error); }
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
  try { localStorage.setItem(MUTED_KEY, JSON.stringify([...mutedPlayers])); }
  catch (error) { console.warn("Could not save local mute preferences.", error); }
}
function getMe() { return room?.players.find(player => player.socketId === socket.id) || null; }
function isHost() { return room?.hostId === getMe()?.id; }
function connectedPlayers() { return (room?.players || []).filter(player => player.connected && !player.eliminated); }
function currentPrivateInfo() {
  const me = getMe();
  if (!room || !privateInfo || !me) return null;
  if (privateInfo.playerId !== me.id || privateInfo.phase !== room.phase || privateInfo.round !== room.round) return null;
  return privateInfo;
}
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
  toast.timer = setTimeout(() => element.classList.remove("show"), 3000);
}
function emitAck(event, data) {
  return new Promise(resolve => {
    if (!socket.connected) return resolve({ ok: false, error: "You are not connected to the room server yet." });
    const timeout = setTimeout(() => resolve({ ok: false, error: "The server did not respond. Check your connection." }), 8000);
    const done = result => {
      clearTimeout(timeout);
      resolve(result || { ok: true });
    };
    if (data === undefined) socket.emit(event, done);
    else socket.emit(event, data, done);
  });
}
function microphoneIconMarkup(isMuted) {
  return `<svg viewBox="0 0 24 24" class="mic-svg" aria-hidden="true">
    <rect x="9" y="3" width="6" height="12" rx="3"></rect>
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6"></path>
    <path class="mic-slash" d="M3 3 21 21"></path>
  </svg>`;
}
function makeModal(title, content) {
  $("modal-content").innerHTML = `<p class="eyebrow"><span class="eyebrow-line"></span> MINDTRAP / ROOM ACCESS</p><h2 id="modal-title">${title}</h2>${content}`;
  $("modal").classList.remove("hidden");
}
function closeModal() { $("modal").classList.add("hidden"); }
function saveAndEnterRoom(result, name) {
  myName = name;
  lastGameResultKey = "";
  gameResultDismissed = false;
  shownVoteResults.clear();
  saveSession({ code: result.code, token: result.token, name });
  closeModal();
  toast(`Connected to room ${result.code}.`);
}
function createRoomModal() {
  makeModal("Create a room", `
    <form id="create-form" class="modal-form">
      <label>YOUR NAME<input id="create-name" maxlength="20" value="${escapeHtml(myName)}" required></label>
      <label>PLAYER LIMIT<select id="create-max">
        <option value="3">3 PLAYERS</option><option value="4">4 PLAYERS</option><option value="6">6 PLAYERS</option>
        <option value="8" selected>8 PLAYERS</option><option value="10">10 PLAYERS</option><option value="12">12 PLAYERS</option><option value="15">15 PLAYERS</option>
      </select></label>
      <label>IMPOSTORS<select id="create-impostors">
        <option value="1">1 IMPOSTOR</option><option value="2">2 IMPOSTORS</option><option value="3">3 IMPOSTORS</option><option value="4">4 IMPOSTORS</option>
      </select></label>
      <label class="checkbox-label"><input id="create-shadow" type="checkbox"><span class="custom-check"></span><span><strong>Include the Shadow</strong><small>A third side with a solo win condition</small></span></label>
      <button class="button button-primary full-width" type="submit">Create room <span aria-hidden="true">↗</span></button>
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
      <label>YOUR NAME<input id="join-name" maxlength="20" value="${escapeHtml(myName)}" required></label>
      <label>ROOM CODE<input id="join-code" maxlength="6" minlength="6" autocomplete="off" placeholder="A1B2C3" required></label>
      <button class="button button-primary full-width" type="submit">Join room <span aria-hidden="true">↗</span></button>
    </form>`);
  $("join-code").addEventListener("input", () => {
    $("join-code").value = $("join-code").value.replace(/[^a-f0-9]/gi, "").toUpperCase().slice(0, 6);
  });
  $("join-form").onsubmit = async event => {
    event.preventDefault();
    const name = $("join-name").value.trim() || "Player";
    const button = $("join-form").querySelector("button");
    button.disabled = true;
    const result = await emitAck("room:join", { name, code: $("join-code").value.trim().toUpperCase() });
    button.disabled = false;
    if (!result.ok) return toast(result.error || "Could not join the room.");
    saveAndEnterRoom(result, name);
  };
}

$("open-create").onclick = createRoomModal;
$("open-join").onclick = joinRoomModal;
$("close-modal").onclick = closeModal;
$("modal").onclick = event => { if (event.target === $("modal")) closeModal(); };
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    if (!$("modal").classList.contains("hidden")) closeModal();
  }
});
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
  lastGameResultKey = "";
  gameResultDismissed = false;
  shownVoteResults.clear();
  window.MindtrapCuby?.dispose();
  $("game-result-overlay").classList.add("hidden");
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
$("close-game-result").onclick = () => {
  gameResultDismissed = true;
  $("game-result-overlay").classList.add("hidden");
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
  const button = $("word-entry-form").querySelector("button");
  button.disabled = true;
  const result = await emitAck("word:submit", { word: $("word-input").value });
  button.disabled = false;
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
  toast("Clue submitted and locked. You can still unsubmit before voting.");
};
$("unsubmit-clue").onclick = async () => {
  const result = await emitAck("clue:unsubmit");
  if (!result.ok) return toast(result.error || "Could not unlock the clue.");
  toast("Clue unlocked. Edit it and submit again.");
};
$("confirm-vote").onclick = async () => {
  if (!selectedVoteId) return;
  const result = await emitAck("vote:submit", { targetId: selectedVoteId });
  if (!result.ok) return toast(result.error || "Could not submit the vote.");
};
$("skip-vote").onclick = async () => {
  const result = await emitAck("vote:skip");
  if (!result.ok) return toast(result.error || "Could not skip the vote.");
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
  $("sfx-toggle").textContent = soundOn ? "SFX ON" : "SFX OFF";
  $("sfx-toggle").setAttribute("aria-pressed", String(soundOn));
};
$("music-toggle").onclick = async () => {
  if (!musicAudio) {
    musicAudio = new Audio("/assets/audio/background-music.mp3");
    musicAudio.loop = true;
    musicAudio.volume = .18;
  }
  if (!musicAudio.paused) {
    musicAudio.pause();
    $("music-toggle").textContent = "MUSIC OFF";
    $("music-toggle").setAttribute("aria-pressed", "false");
    return;
  }
  try {
    await musicAudio.play();
    $("music-toggle").textContent = "MUSIC ON";
    $("music-toggle").setAttribute("aria-pressed", "true");
  } catch (error) {
    console.warn("Background music is not available or playback was blocked.", error);
    toast("Add background-music.mp3 to public/assets/audio to use music.");
  }
};

function playSfx(name) {
  if (!soundOn || !SFX[name]) return;
  const audio = new Audio(SFX[name]);
  audio.volume = .42;
  audio.play().catch(() => {});
}
function avatarMarkup(player) {
  const initial = escapeHtml((player.name || "?").trim().charAt(0).toUpperCase());
  const index = [...String(player.id)].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return `<span class="avatar avatar-${AVATAR_COLORS[index % AVATAR_COLORS.length]}">${initial}</span>`;
}
function renderLobby() {
  const host = isHost();
  const count = room.players.filter(player => player.connected).length;
  $("host-settings").classList.toggle("hidden", !host);
  $("max-players").disabled = !host;
  $("impostor-count").disabled = !host;
  $("shadow-enabled").disabled = !host;
  const hasOfflinePlayers = room.players.some(player => !player.connected);
  const actualMaxImpostors = count >= 3
    ? Math.min(4, Math.floor((count - 1) / 2), count - (room.settings.shadowEnabled ? 2 : 1))
    : 0;
  const invalidImpostorCount = count >= 3 && room.settings.impostors > actualMaxImpostors;
  $("start-game").classList.toggle("hidden", !host);
  $("start-game").disabled = count < 3 || hasOfflinePlayers || invalidImpostorCount;
  $("lobby-note").textContent = count < 3
    ? "At least 3 connected players are required to start."
    : hasOfflinePlayers
      ? "Remove offline players before starting. Every role must belong to an active player."
      : invalidImpostorCount
        ? `With ${count} connected players, choose no more than ${actualMaxImpostors} Impostor(s) to keep the match balanced.`
        : "Everyone is connected. The host can start the match.";
  $("lobby-player-list").innerHTML = room.players.map((player, index) => `
    <div class="player-card ${player.connected ? "" : "is-offline"}" style="animation-delay:${Math.min(index * 45, 360)}ms">
      ${avatarMarkup(player)}
      <span class="player-name">${escapeHtml(player.name)}${player.id === room.hostId ? " · HOST" : ""}</span>
      <span class="player-status">${player.connected ? "READY HERE" : "OFFLINE"}</span>
    </div>`).join("");
}
function renderRoster() {
  $("player-list").innerHTML = room.players.map(player => {
    const self = player.socketId === socket.id;
    const localMute = mutedPlayers.has(player.id);
    const muteButton = player.connected && !self
      ? `<button class="mic-icon-toggle ${localMute ? "is-muted" : ""}" type="button" data-mute="${escapeHtml(player.id)}" aria-label="${localMute ? "Unmute" : "Mute"} ${escapeHtml(player.name)}" aria-pressed="${localMute}">${microphoneIconMarkup(localMute)}</button>`
      : "";
    const removeButton = isHost() && !player.connected
      ? `<button class="button button-quiet button-small" type="button" data-remove-player="${escapeHtml(player.id)}" aria-label="Remove ${escapeHtml(player.name)}">REMOVE</button>`
      : "";
    let status = player.connected ? (player.voiceEnabled ? "MIC ON" : "MIC OFF") : "OFFLINE";
    let statusMarkup = escapeHtml(status);
    if (player.eliminated) statusMarkup = "ELIMINATED";
    if (room.phase === "ready" && player.connected && !player.eliminated) statusMarkup = player.ready ? "READY" : "NOT READY";
    if (room.phase === "clues" && player.connected && !player.eliminated) {
      statusMarkup = player.hasSubmittedClue
        ? "SUBMITTED"
        : '<span class="typing-status"><span>Writing</span><span class="typing-dots" aria-label="Writing"><i></i><i></i><i></i></span></span>';
    }
    return `<div class="roster-player ${player.eliminated ? "is-eliminated" : ""} ${player.connected ? "" : "is-offline"}">
      ${avatarMarkup(player)}
      <span class="player-name">${escapeHtml(player.name)}${self ? " · YOU" : player.id === room.hostId ? " · HOST" : ""}</span>
      <span class="player-status">${statusMarkup}</span>
      <span class="player-controls">${muteButton}${removeButton}</span>
    </div>`;
  }).join("");
  $("player-list").querySelectorAll("[data-mute]").forEach(button => {
    button.onclick = () => {
      const playerId = button.dataset.mute;
      if (mutedPlayers.has(playerId)) mutedPlayers.delete(playerId);
      else mutedPlayers.add(playerId);
      const nowMuted = mutedPlayers.has(playerId);
      button.classList.toggle("is-muted", nowMuted);
      button.setAttribute("aria-pressed", String(nowMuted));
      button.setAttribute("aria-label", `${nowMuted ? "Unmute" : "Mute"} ${button.getAttribute("aria-label").replace(/^(Unmute|Mute) /, "")}`);
      saveMutedPlayers();
      applyPeerMuteState();
    };
  });
  $("player-list").querySelectorAll("[data-remove-player]").forEach(button => {
    button.onclick = async () => {
      const result = await emitAck("player:remove-offline", { playerId: button.dataset.removePlayer });
      if (!result.ok) toast(result.error || "Could not remove the offline player.");
    };
  });
}
function renderIdentity() {
  const shouldShow = ["ready", "clues", "voting", "waiting"].includes(room.phase);
  $("identity-card").classList.toggle("hidden", !shouldShow);
  if (!shouldShow) return;

  const info = currentPrivateInfo();
  const card = $("identity-card");
  if (!info || !info.role) {
    card.removeAttribute("data-role");
    $("role-label").textContent = "LOADING ROLE";
    $("role-symbol").textContent = "…";
    $("secret-word").textContent = "Waiting for your private information…";
    $("role-note").textContent = "Your role is sent privately by the game server.";
    return;
  }

  const labels = { innocent: "INNOCENT", impostor: "IMPOSTOR", shadow: "SHADOW" };
  const symbols = { innocent: "◇", impostor: "×", shadow: "◈" };
  card.dataset.role = info.role;
  $("role-label").textContent = labels[info.role] || "UNKNOWN";
  $("role-symbol").textContent = symbols[info.role] || "?";
  if (info.role === "impostor") {
    $("secret-word").textContent = "YOU DON'T KNOW THE WORD";
    $("role-note").textContent = "Blend in. Listen carefully and make your clue convincing.";
  } else {
    $("secret-word").textContent = info.word || "Waiting for the secret word…";
    $("role-note").textContent = info.role === "shadow"
      ? "You know the word. Get voted out by a unique majority to win alone."
      : "Keep the word private. Find the Impostor before they reach parity.";
  }
}
function renderClueStatuses() {
  $("clues-list").innerHTML = room.players.map(player => {
    let status;
    let statusClass = "";
    if (player.eliminated) status = "Eliminated";
    else if (!player.connected) status = "Offline";
    else if (player.hasSubmittedClue) { status = "Submitted"; statusClass = "is-submitted"; }
    else status = `<span class="typing-status"><span>Writing</span><span class="typing-dots" aria-label="Writing"><i></i><i></i><i></i></span></span>`;
    return `<div class="clue-item ${statusClass}">${avatarMarkup(player)}<span class="player-name">${escapeHtml(player.name)}${player.socketId === socket.id ? " · YOU" : ""}</span><span class="player-status">${status}</span></div>`;
  }).join("");
}
function renderVotePanel() {
  $("vote-clues").innerHTML = room.clues.map(clue => {
    const player = room.players.find(candidate => candidate.id === clue.playerId);
    if (!player) return "";
    return `<article class="clue-card"><strong>${escapeHtml(player.name)}</strong><p>${escapeHtml(clue.text)}</p></article>`;
  }).join("");
  const me = getMe();
  const info = currentPrivateInfo();
  const hasVoted = !!info?.hasVoted;
  $("vote-options").innerHTML = connectedPlayers()
    .filter(player => player.socketId !== socket.id)
    .map(player => `<button class="vote-option ${selectedVoteId === player.id ? "is-selected" : ""}" type="button" data-vote-target="${escapeHtml(player.id)}" ${hasVoted ? "disabled" : ""}>
      ${avatarMarkup(player)}<span>${escapeHtml(player.name)}</span></button>`).join("");
  $("vote-options").querySelectorAll("[data-vote-target]").forEach(button => {
    button.onclick = () => {
      selectedVoteId = button.dataset.voteTarget;
      renderVotePanel();
    };
  });
  $("vote-progress").textContent = `${Math.min(room.voteCount, room.requiredActions)} of ${room.requiredActions} votes submitted`;
  $("confirm-vote").classList.toggle("hidden", hasVoted || !!me?.eliminated);
  $("confirm-vote").disabled = !selectedVoteId;
  const selectedPlayer = room.players.find(player => player.id === selectedVoteId);
  $("confirm-vote").textContent = selectedPlayer ? `Vote for ${selectedPlayer.name}` : "Choose a player to vote";
  $("skip-vote").classList.toggle("hidden", hasVoted || !!me?.eliminated);
  $("vote-locked-note").classList.toggle("hidden", !hasVoted && !me?.eliminated);
  if (me?.eliminated) $("vote-locked-note").textContent = "You were eliminated. You can still talk and listen in the room.";
}
function renderGamePhase() {
  if (!room || room.phase === "lobby") return;
  GAME_STATES.forEach(id => $(id).classList.add("hidden"));
  $("round-number").textContent = room.round;
  const phaseNames = {
    "word-entry": ["WORD ENTRY", "The first move."],
    ready: ["PRIVATE BRIEFING", "Know your role."],
    clues: ["CLUE ROUND", "Say just enough."],
    voting: ["DISCUSSION + VOTE", "Find the Impostor."],
    waiting: ["WAITING FOR PLAYERS", "The match is paused."],
    "game-over": ["MATCH COMPLETE", "The truth is out."]
  };
  const [phaseLabel, title] = phaseNames[room.phase] || ["MATCH", "The next move."];
  $("phase-label").textContent = phaseLabel;
  $("game-title").textContent = title;
  renderIdentity();

  if (room.phase === "word-entry") {
    $("word-entry-panel").classList.remove("hidden");
    const info = currentPrivateInfo();
    const isSetter = info?.isWordSetter === true;
    $("word-entry-form").classList.toggle("hidden", !isSetter || room.wordSubmitted);
    $("word-entry-note").textContent = room.wordSetterOffline
      ? "The selected word setter is offline. The host can choose another Innocent."
      : isSetter ? "You are the selected Innocent. Choose a word and submit it privately."
        : "An Innocent is choosing the word. Their identity stays private.";
    $("word-reselect").classList.toggle("hidden", !isHost() || !room.wordSetterOffline);
  } else if (room.phase === "ready") {
    $("ready-panel").classList.remove("hidden");
    const me = getMe();
    $("ready-progress").textContent = `${room.readyCount} OF ${room.requiredActions} PLAYERS READY`;
    $("ready-button").disabled = !!me?.ready;
    $("ready-button").textContent = me?.ready ? "You're ready ✓" : "I'm ready ↗";
  } else if (room.phase === "clues") {
    $("clue-panel").classList.remove("hidden");
    $("clue-progress").textContent = `${room.clueCount} OF ${room.requiredActions} CLUES SUBMITTED`;
    const info = currentPrivateInfo();
    const submitted = !!info?.hasSubmittedClue;
    const me = getMe();
    $("clue-form").classList.toggle("hidden", !me || me.eliminated);
    $("clue-input").disabled = submitted || !!me?.eliminated;
    $("submit-clue").classList.toggle("hidden", submitted || !!me?.eliminated);
    $("unsubmit-clue").classList.toggle("hidden", !submitted || !!me?.eliminated);
    $("clue-locked-note").classList.toggle("hidden", !submitted);
    if (info && !$("clue-input").matches(":focus") && !submitted) $("clue-input").value = info.clueDraft || "";
    if (submitted && info?.clueDraft) $("clue-input").value = info.clueDraft;
    renderClueStatuses();
  } else if (room.phase === "voting") {
    $("vote-panel").classList.remove("hidden");
    renderVotePanel();
  } else if (room.phase === "waiting") {
    $("waiting-panel").classList.remove("hidden");
  } else if (room.phase === "game-over") {
    showGameResult();
  }
}
function renderRoom() {
  if (!room) return;
  $("home-screen").classList.add("hidden");
  $("room-screen").classList.remove("hidden");
  $("room-code-title").textContent = room.code;
  $("room-phase").innerHTML = `<span class="eyebrow-line"></span> ${room.phase === "game-over" ? "MATCH COMPLETE" : escapeHtml(room.phase.toUpperCase().replaceAll("-", " "))}`;
  $("roster-status").textContent = room.phase === "lobby" ? "LOBBY" : `ROUND ${room.round}`;
  $("player-count").textContent = `${room.players.filter(player => player.connected).length}/${room.settings.maxPlayers}`;
  $("max-players").value = String(room.settings.maxPlayers);
  $("impostor-count").value = String(room.settings.impostors);
  $("shadow-enabled").checked = room.settings.shadowEnabled;

  const inLobby = room.phase === "lobby";
  $("lobby-panel").classList.toggle("hidden", !inLobby);
  $("game-panel").classList.toggle("hidden", inLobby);
  if (inLobby) {
    $("identity-card").classList.add("hidden");
    $("game-result-overlay").classList.add("hidden");
    window.MindtrapCuby?.dispose();
    renderLobby();
  }
  renderRoster();
  renderChatHistory(room.chatHistory || []);
  if (!inLobby) renderGamePhase();
  if (room.lastVoteResults && !shownVoteResults.has(room.lastVoteResults.id)) showVoteResults(room.lastVoteResults);
  updatePhaseTimer();
  syncVoicePeers();
}

function renderChatHistory(messages) {
  const container = $("chat-messages");
  container.replaceChildren();
  if (!messages.length) {
    const note = document.createElement("p");
    note.className = "system-message";
    note.textContent = "Chat stays open to everyone, even after elimination.";
    container.append(note);
  } else messages.forEach(appendChatMessage);
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
    : results.tied ? "The vote was tied" : "No one was voted out";
  const roleLabel = results.eliminatedRole === "impostor" ? "Impostor"
    : results.eliminatedRole === "shadow" ? "Shadow"
      : results.eliminatedRole === "innocent" ? "Innocent" : "";
  $("vote-result-copy").textContent = results.eliminatedName
    ? `Their role was ${roleLabel}. The votes are grouped below.`
    : results.tied ? "The top vote counts were tied. Nobody was eliminated."
      : "All votes were skipped. The match continues.";
  const groups = results.groupedCounts || [];
  const maxCount = Math.max(1, ...groups.map(group => group.count));
  $("vote-details").innerHTML = groups.map((group, index) => `
    <div class="vote-group-row" style="animation-delay:${index * 70}ms">
      <div class="vote-group-main">
        <div class="vote-group-player"><span class="avatar avatar-violet">${escapeHtml(group.playerName.charAt(0).toUpperCase())}</span><span>${escapeHtml(group.playerName)}</span></div>
        <span class="vote-group-track"><span style="width:${Math.round(group.count / maxCount * 100)}%"></span></span>
      </div>
      <span class="vote-count">×${group.count}</span>
    </div>`).join("") + (results.skippedCount
      ? `<div class="vote-skipped"><span>SKIPPED VOTES</span><strong>×${results.skippedCount}</strong></div>` : "");
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (window.gsap && !reduceMotion) window.gsap.fromTo(".vote-group-row", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .28, stagger: .07, ease: "power2.out" });
  $("vote-result-overlay").classList.remove("hidden");
}
function showGameResult() {
  const info = currentPrivateInfo();
  const key = `${room.code}:${room.round}:${room.winner?.role || "none"}:${room.winner?.playerId || "team"}`;
  const changed = !!info && key !== lastGameResultKey;
  const role = info?.role || null;
  const outcome = info?.result || null;
  const victory = outcome === "victory";
  const winner = room.winner || {};
  const winnerName = winner.playerId ? room.players.find(player => player.id === winner.playerId)?.name : null;
  const winningTeam = winner.role === "shadow" ? "THE SHADOW"
    : winner.role === "impostors" ? "IMPOSTORS"
      : "INNOCENTS";

  $("game-result-card").classList.toggle("is-defeat", !victory);
  $("game-result-title").textContent = info ? (victory ? "VICTORY" : "DEFEAT") : "MATCH COMPLETE";
  $("game-result-kicker").textContent = !info ? "RECEIVING YOUR PRIVATE RESULT"
    : victory ? "YOU SURVIVED THE MIND GAME" : "THIS ROUND DIDN'T GO YOUR WAY";
  $("game-result-team").textContent = `${winningTeam} WIN`;
  let copy = "The match is complete.";
  if (winner.role === "shadow") copy = victory
    ? "You were the Shadow. The room voted you out, and that was exactly the plan."
    : `${winnerName || "The Shadow"} was uniquely voted out and claimed a solo victory.`;
  else if (winner.role === "impostors") copy = victory
    ? "The Impostors reached parity with the other living players. You blended in long enough."
    : "The Impostors reached parity with the other living players. The room lost control.";
  else if (winner.role === "innocents") copy = victory
    ? "Every Impostor has been eliminated. The Innocents kept the word safe."
    : role === "shadow" ? "The Innocents eliminated every Impostor, but the Shadow did not achieve its solo win condition."
      : "Every Impostor has been eliminated. The Innocents kept the word safe.";
  $("game-result-copy").textContent = info ? copy : "Your private role and result are still being delivered.";
  $("new-match").classList.toggle("hidden", !isHost());
  $("new-match-note").textContent = isHost()
    ? "The next match resets the roles and selects a new word."
    : "Waiting for the host to start another match.";
  $("close-game-result").classList.toggle("hidden", !info);
  $("game-result-overlay").classList.toggle("hidden", gameResultDismissed);

  if (changed) {
    lastGameResultKey = key;
    if (window.MindtrapCuby) window.MindtrapCuby.show(victory ? "victory" : "defeat");
    else window.addEventListener("mindtrap:cuby-ready", () => window.MindtrapCuby?.show(victory ? "victory" : "defeat"), { once: true });
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (window.gsap && !reduceMotion) {
      window.gsap.fromTo("#game-result-card", { opacity: 0, y: 22, scale: .97 }, { opacity: 1, y: 0, scale: 1, duration: .65, ease: "power3.out" });
      window.gsap.fromTo(".result-footer > *", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: .3, stagger: .07, delay: .25 });
    }
  }
}

socket.on("room:update", data => {
  const previousRoom = room;
  if (!previousRoom || data.phase !== previousRoom.phase || data.round !== previousRoom.round) privateInfo = null;
  room = data;
  if (previousRoom && data.round > previousRoom.round) playSfx("start");
  if (data.phase !== "voting") selectedVoteId = null;
  if (data.phase === "lobby" && previousRoom?.phase === "game-over") {
    lastGameResultKey = "";
    gameResultDismissed = false;
  }
  renderRoom();
});
socket.on("game:private", data => {
  privateInfo = data;
  if (room) {
    if (room.phase === "game-over") showGameResult();
    else renderGamePhase();
  }
});
socket.on("game:vote-results", showVoteResults);
socket.on("game:notice", data => { if (data?.message) toast(data.message); });
socket.on("chat:message", appendChatMessage);
socket.on("connect", async () => {
  $("connection-label").classList.remove("is-error");
  $("connection-label").classList.add("is-connected");
  $("connection-label").innerHTML = '<span class="connection-dot"></span> CONNECTED';
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
  if (micEnabled) {
    socket.emit("voice:state", { enabled: true });
    await syncLocalMicTracks();
  }
  toast("Rejoined your room.");
});
socket.on("disconnect", () => {
  $("connection-label").classList.remove("is-connected");
  $("connection-label").classList.add("is-error");
  $("connection-label").innerHTML = '<span class="connection-dot"></span> RECONNECTING';
  $("voice-status").textContent = "Connection lost. Rejoining the room…";
  closeAllPeers();
});
socket.on("connect_error", error => {
  console.warn("Room connection failed.", error);
  $("connection-label").classList.remove("is-connected");
  $("connection-label").classList.add("is-error");
  $("connection-label").innerHTML = '<span class="connection-dot"></span> CONNECTION ERROR';
});

function updateMicButton() {
  const button = $("mic-toggle");
  button.classList.toggle("is-on", micEnabled);
  button.setAttribute("aria-pressed", String(micEnabled));
  button.setAttribute("aria-label", micEnabled ? "Mute microphone" : "Enable microphone");
  $("mic-toggle-label").textContent = micEnabled ? "MIC ON" : "MIC OFF";
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
      await syncLocalMicTracks();
      socket.emit("voice:state", { enabled: true });
      updateMicButton();
      $("voice-status").textContent = "Mic is on. You can mute other players locally.";
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
  $("voice-status").textContent = micEnabled
    ? "Mic is on. You can mute other players locally."
    : "Mic is muted. Your voice connections stay open, so you can still listen.";
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
  if (socket.connected) socket.emit("voice:signal", { targetSocketId, signal });
}
function applyPeerMuteState() {
  for (const player of room?.players || []) {
    if (!player.socketId) continue;
    const audio = document.getElementById(`audio-${player.socketId}`);
    if (audio) audio.muted = mutedPlayers.has(player.id);
  }
}
async function syncLocalMicTracks() {
  const track = micEnabled ? micStream?.getAudioTracks()[0] || null : null;
  await Promise.all([...peers.values()].map(async peer => {
    if (peer.audioSender) {
      try { await peer.audioSender.replaceTrack(track); }
      catch (error) { console.warn("Could not update an outgoing microphone track.", error); }
    }
  }));
}
async function syncVoicePeers() {
  if (!room || !socket.id) return;
  const me = getMe();
  const desired = new Set(room.players
    .filter(player => player.id !== me?.id && player.connected && player.socketId)
    .map(player => player.socketId));
  for (const socketId of peers.keys()) if (!desired.has(socketId)) closePeer(socketId);
  for (const player of room.players) {
    if (!desired.has(player.socketId) || peers.has(player.socketId)) continue;
    // A deterministic offerer prevents both sides from creating an offer at once.
    if (socket.id.localeCompare(player.socketId) < 0) {
      try { await createAndOffer(player.socketId); }
      catch (error) {
        console.warn("Could not start the voice connection.", error);
        $("voice-status").textContent = "Voice could not connect. Check the network or TURN settings.";
      }
    }
  }
  await syncLocalMicTracks();
}
function createPeer(targetSocketId) {
  if (peers.has(targetSocketId)) return peers.get(targetSocketId);
  const peer = new RTCPeerConnection({ iceServers, bundlePolicy: "max-bundle" });
  peer.pendingCandidates = [];
  peer.makingOffer = false;
  const transceiver = peer.addTransceiver("audio", { direction: "sendrecv" });
  peer.audioSender = transceiver.sender;
  const localTrack = micEnabled ? micStream?.getAudioTracks()[0] || null : null;
  if (localTrack) peer.audioSender.replaceTrack(localTrack).catch(error => console.warn("Could not attach the local microphone.", error));
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
    audio.srcObject = event.streams?.[0] || new MediaStream([event.track]);
    audio.play().catch(error => {
      console.warn("Incoming voice playback was blocked.", error);
      $("voice-status").textContent = "Tap the page once to allow incoming voice audio.";
    });
  };
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "connected") {
      $("voice-status").textContent = micEnabled ? "Voice connected. Your mic is on." : "Voice connected. Listening mode is on.";
    }
    if (peer.connectionState === "failed") {
      closePeer(targetSocketId);
      $("voice-status").textContent = "Voice connection failed. A TURN server may be needed on this network.";
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
socket.on("voice:signal", async (payload = {}) => {
  const { fromId, signal } = payload;
  if (typeof fromId !== "string" || !signal || typeof signal !== "object") return;
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
    $("voice-status").textContent = "Voice connection issue. Try toggling your microphone or checking TURN settings.";
  }
});

function updatePhaseTimer() {
  const timer = $("phase-timer");
  if (!room?.phaseDeadline || !["word-entry", "ready", "clues", "voting"].includes(room.phase)) {
    timer.classList.add("hidden");
    timer.classList.remove("is-urgent");
    return;
  }
  const remaining = Math.max(0, Math.ceil((room.phaseDeadline - Date.now()) / 1000));
  const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
  const seconds = String(remaining % 60).padStart(2, "0");
  timer.textContent = `${minutes}:${seconds}`;
  timer.classList.remove("hidden");
  timer.classList.toggle("is-urgent", remaining <= 10);
}
setInterval(updatePhaseTimer, 1000);
updateMicButton();
