const socket = io();
const $ = id => document.getElementById(id);
const screens = ["home-screen","lobby-screen","game-screen"];
const phasePanels = ["reveal-panel","clues-panel","discussion-panel","voting-panel","results-panel","picker-panel","word-entry-panel","picker-results-panel"];
let room = null, privateInfo = null, myRoomCode = null, myName = "Player";
let soundOn = true, micStream = null, peers = new Map(), hasVoted = false, hasPickerVoted = false;
const avatarClasses = ["avatar-purple","avatar-orange","avatar-blue","avatar-pink"];
const faces = ["◕‿◕","ಠ_ಠ","•ᴗ•","¬‿¬","◉ᴗ◉","ᵔᴥᵔ","ಠ‿ಠ","•̀ᴗ•́"];
function avatar(id, extra="") {
  let n = [...String(id || "x")].reduce((a,c)=>a+c.charCodeAt(0),0);
  return `<div class="avatar ${avatarClasses[n%avatarClasses.length]} ${extra}"><span class="avatar-face">${faces[n%faces.length]}</span><i></i></div>`;
}
function showScreen(id) { screens.forEach(s => $(s).classList.toggle("active",s===id)); }
function toast(message) {
  const el=$("toast"); el.textContent=message; el.classList.add("show");
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove("show"),2600);
}
function modal(content) { $("modal-content").innerHTML=content; $("modal").classList.remove("hidden"); }
function closeModal() {$("modal").classList.add("hidden");}
function emitAck(event,data) {
  return new Promise(resolve=>socket.emit(event,data||{},result=>resolve(result||{ok:true})));
}
function getMe() { return room?.players.find(p=>p.id===socket.id); }
function isHost() { return room?.hostId===socket.id; }
function activePlayers() { return (room?.players||[]).filter(p=>p.connected&&!p.eliminated); }
function setButtonHostHint(buttonId,hintId,text) {
  $(buttonId).disabled=!isHost(); $(hintId).classList.toggle("hidden",isHost()); $(hintId).textContent=text;
}
$("open-create").onclick=()=>modal(`<div class="eyebrow">START A NEW GAME</div><h2>Gather your crew.</h2><p>Create a room and share the code with your friends.</p><label>YOUR NICKNAME<input id="create-name" maxlength="20" placeholder="e.g. Shadow" value="${escapeHtml(myName)}"></label><label>PLAYER LIMIT<select id="create-max"><option value="4">4 players</option><option value="8" selected>8 players</option><option value="10">10 players</option><option value="12">12 players</option><option value="15">15 players</option></select></label><label>IMPOSTORS<select id="create-impostors"><option value="1">1 impostor</option><option value="2">2 impostors</option><option value="3">3 impostors</option></select></label><button id="create-submit" class="primary-button full">Create room →</button>`);
$("open-join").onclick=()=>modal(`<div class="eyebrow">YOU'VE BEEN INVITED</div><h2>Join the room.</h2><p>Enter the room code your friend shared.</p><label>YOUR NICKNAME<input id="join-name" maxlength="20" placeholder="e.g. Shadow" value="${escapeHtml(myName)}"></label><label>ROOM CODE<input id="join-code" maxlength="6" placeholder="ABC123" style="text-transform:uppercase;letter-spacing:4px"></label><button id="join-submit" class="primary-button full">Join room →</button>`);
$("close-modal").onclick=closeModal;
$("modal").onclick=e=>{if(e.target===$("modal"))closeModal()};
$("modal-content").addEventListener("click", async e => {
 const target = e.target.closest("button");
 if (!target) return;
 if (target.id === "create-submit") {
   myName = $("create-name").value.trim() || "Player";
   target.disabled = true;
   const res = await emitAck("room:create", {name:myName, maxPlayers:+$("create-max").value, impostors:+$("create-impostors").value});
   target.disabled = false;
   if (!res.ok) return toast(res.error || "Couldn't create room");
   myRoomCode = res.code; closeModal(); toast("Room created! Share your code.");
 }
 if (target.id === "join-submit") {
   myName = $("join-name").value.trim() || "Player";
   const code = $("join-code").value.trim().toUpperCase();
   target.disabled = true;
   const res = await emitAck("room:join", {name:myName, code});
   target.disabled = false;
   if (!res.ok) return toast(res.error || "Couldn't join room");
   myRoomCode = res.code; closeModal(); toast("Joined room!");
 }
});
$("copy-code").onclick=async()=>{try{await navigator.clipboard.writeText(myRoomCode);toast("Room code copied!")}catch{toast("Room code: "+myRoomCode)}};
$("leave-room").onclick=()=>{location.reload()};
$("start-game").onclick=async()=>{const r=await emitAck("game:start");if(!r.ok)toast(r.error||"Couldn't start game")};
$("ready-clues").onclick=async()=>{if(!isHost()){toast("Wait for the host to start the clue round.");return}const r=await emitAck("game:begin-clues");if(!r.ok)toast("Couldn't start clues")};
$("submit-clue").onclick=submitClue;
$("clue-input").addEventListener("keydown",e=>{if(e.key==="Enter")submitClue()});
async function submitClue(){
 const res=await emitAck("clue:submit",{text:$("clue-input").value});
 if(!res.ok)return toast(res.error||"Couldn't send clue");
 $("clue-input").value=""; $("clue-form").classList.add("hidden"); toast("Clue submitted!");
}
$("open-voting").onclick=async()=>{const r=await emitAck("discussion:start-vote");if(!r.ok)toast("Only the host can start voting.")};
$("next-step").onclick=async()=>{if(!isHost())return toast("Wait for the host.");const r=await emitAck("round:next");if(!r.ok)toast(r.error||"Couldn't continue")};
$("start-next-round").onclick=async()=>{if(!isHost())return toast("Wait for the host.");const r=await emitAck("round:next");if(!r.ok)toast(r.error||"Couldn't start round")};
$("submit-word").onclick=submitWord;
$("word-entry-input").addEventListener("keydown",e=>{if(e.key==="Enter")submitWord()});
async function submitWord(){
 const word=$("word-entry-input").value.trim();
 if(!word)return toast("Type a word first.");
 const res=await emitAck("word:submit",{word});
 if(!res.ok)return toast(res.error||"Couldn't set word.");
 $("word-entry-input").value=""; toast("Secret word submitted!");
}
$("chat-form").onsubmit=async e=>{e.preventDefault();const input=$("chat-input");const text=input.value.trim();if(!text)return;const r=await emitAck("chat:send",{text});if(r.ok)input.value="";else toast(r.error||"Message failed")};
$("sound-toggle").onclick=()=>{soundOn=!soundOn;$("sound-toggle").textContent=soundOn?"♫":"♪";toast(soundOn?"Sound effects on":"Sound effects off")};

socket.on("room:update",data=>{
 room=data; myRoomCode=data.code;
 if(data.phase==="lobby")showScreen("lobby-screen");else showScreen("game-screen");
 renderRoom();
});
socket.on("game:private",data=>{privateInfo=data;renderPrivate()});
socket.on("chat:message",msg=>{
 const div=document.createElement("div");div.className="chat-message";
 const time=new Date(msg.time).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
 const name=document.createElement("strong");name.textContent=msg.name;
 const text=document.createElement("span");text.textContent=msg.text;
 const tm=document.createElement("span");tm.className="time";tm.textContent=time;
 div.append(name,text,tm);$("chat-messages").append(div);$("chat-messages").scrollTop=$("chat-messages").scrollHeight;
});
socket.on("connect",()=>$("connection-label").textContent="ONLINE PARTY GAME");
socket.on("disconnect",()=>$("connection-label").textContent="RECONNECTING…");

function renderRoom(){
 if(!room)return;
 $("room-code-title").textContent=room.code;$("room-code-copy").textContent=room.code;
 $("game-room-code").textContent=room.code;$("round-number").textContent=room.round||1;
 $("player-count").textContent=`${room.players.length}/${room.settings.maxPlayers}`;
 $("max-players").value=room.settings.maxPlayers;$("impostor-count").value=room.settings.impostors;
 $("start-game").disabled=!isHost()||room.players.length<3;
 $("start-game").textContent=isHost()?"Start game →":"Waiting for host…";
 $("max-players").disabled=!isHost();$("impostor-count").disabled=!isHost();
 $("lobby-players").innerHTML=room.players.map(p=>`<div class="player-tile">${avatar(p.id)}<div><strong>${escapeHtml(p.name)}${p.id===socket.id?" (you)":""}</strong><small>${p.isHost?"HOST":p.connected?"READY":"RECONNECTING"}</small></div></div>`).join("");
 $("game-roster").innerHTML=room.players.map(p=>`<div class="roster-player ${p.eliminated?"eliminated":""}">${avatar(p.id)}<div><strong>${escapeHtml(p.name)}${p.id===socket.id?" (you)":""}</strong><small>${p.isHost?"Host":p.eliminated?"Voted out":p.connected?"In game":"Disconnected"}</small></div><span class="status">${p.connected?"●":""}</span></div>`).join("");
 $("phase-chip").textContent=String(room.phase||"lobby").replaceAll("-"," ").toUpperCase();
 phasePanels.forEach(id=>$(id).classList.add("hidden"));
 const map={reveal:"reveal-panel",clues:"clues-panel",discussion:"discussion-panel",voting:"voting-panel",results:"results-panel","picker-vote":"picker-panel","word-entry":"word-entry-panel","picker-results":"picker-results-panel"};
 if(map[room.phase])$(map[room.phase]).classList.remove("hidden");
 if(room.phase==="lobby")showScreen("lobby-screen");
 if(room.phase!=="lobby")showScreen("game-screen");
 if(room.phase==="clues")renderClues();
 if(room.phase==="discussion")renderDiscussion();
 if(room.phase==="voting")renderVoting();
 if(room.phase==="results")renderResults();
 if(room.phase==="picker-vote")renderPicker();
 if(room.phase==="picker-results")renderPickerResults();
 if(room.phase==="word-entry")renderWordEntry();
}
function renderPrivate(){
 if(!privateInfo)return;
 $("secret-word").textContent=privateInfo.word||"???";
 $("secret-category").textContent=privateInfo.category||"SECRET CATEGORY";
 $("secret-card").classList.toggle("impostor-card",privateInfo.role==="impostor");
 $("role-note").textContent=privateInfo.role==="impostor"?"You are the IMPOSTOR. Blend in and figure out the word.":`You're a regular player. Keep the word secret.${privateInfo.protectedFromImpostor?" You cannot be an impostor next round.":""}`;
 $("secret-word").style.color=privateInfo.role==="impostor"?"var(--pink)":"var(--text)";
 $("host-reveal-hint").textContent=isHost()?"Tap “I'm ready” when the room is ready to begin clues.":"Waiting for the host to begin clues.";
}
function renderClues(){
 const current=room.currentSpeakerId;
 const p=room.players.find(x=>x.id===current);
 $("speaker-name").textContent=p?p.name:"All clues submitted";
 $("turn-instruction").textContent=current===socket.id?"It's your turn. Give a subtle clue.":`${p?p.name:"The next player"} is giving a clue.`;
 $("clue-form").classList.toggle("hidden",current!==socket.id||room.clues.some(c=>c.playerId===socket.id));
 $("clue-input").disabled=current!==socket.id;
 $("clues-list").innerHTML=room.clues.map(c=>{const player=room.players.find(p=>p.id===c.playerId);return clueMarkup(player,c.text)}).join("");
}
function clueMarkup(player,text){if(!player)return"";return `<div class="clue-item">${avatar(player.id)}<div><strong>${escapeHtml(player.name)}</strong><p>${escapeHtml(text)}</p></div></div>`}
function renderDiscussion(){
 $("discussion-clues").innerHTML=room.clues.map(c=>{const p=room.players.find(x=>x.id===c.playerId);return clueMarkup(p,c.text)}).join("");
 setButtonHostHint("open-voting","discussion-host-hint","Only the host can start voting.");
}
function renderVoting(){
 const me=getMe();hasVoted=!!me?.voted;
 $("vote-options").innerHTML=activePlayers().filter(p=>p.id!==socket.id).map(p=>`<button class="vote-option" data-vote="${p.id}" ${hasVoted?"disabled":""}>${avatar(p.id)}<span>${escapeHtml(p.name)}</span></button>`).join("")+
 `<button class="vote-option skip-option" data-vote="skip" ${hasVoted?"disabled":""}><span class="avatar avatar-orange"><span class="avatar-face">↷</span></span><span>Skip vote</span></button>`;
 $("vote-progress").textContent=`${room.voteCount} / ${room.totalVoters} votes submitted`;
 $("vote-options").querySelectorAll("[data-vote]").forEach(btn=>btn.onclick=async()=>{const r=await emitAck("vote:submit",{targetId:btn.dataset.vote});if(!r.ok)toast(r.error||"Vote failed");else toast("Vote submitted privately")});
}
function renderResults(){
 const r=room.voteResults||{};
 if(room.winner){$("result-title").textContent=room.winner==="players"?"IMPOSTOR CAUGHT!":"IMPOSTORS WIN";$("result-copy").textContent=room.winner==="players"?"The regular players found every impostor.":"The impostors outnumbered the remaining regular players."; $("result-card").innerHTML=`<strong>${room.winner==="players"?"Regular players win!":"Impostors win!"}</strong><p>Start a new room to play again. Full rematch support can be added next.</p>`;$("next-step").classList.add("hidden");$("result-host-hint").textContent="";return}
 $("next-step").classList.remove("hidden");
 $("result-title").textContent=r.eliminatedName?`${escapeHtml(r.eliminatedName)} was voted out`:r.skipped?"The room skipped!":"It's a tie!";
 $("result-copy").textContent=r.eliminatedName?"The vote is locked. The player stays in the room and can still chat and use voice.":r.skipped?"No one is removed this round.":"No clear majority. No one is removed.";
 $("result-card").innerHTML=r.eliminatedName?`<strong>${escapeHtml(r.eliminatedName)}</strong><p>Role revealed: <b>${r.eliminatedRole==="impostor"?"IMPOSTOR":"REGULAR PLAYER"}</b></p>`:`<strong>${r.skipped?"Skip vote":"Tied votes"}</strong><p>No player was eliminated. Discuss again in the next round.</p>`;
 setButtonHostHint("next-step","result-host-hint","Only the host can continue.");
}
function renderPicker(){
 hasPickerVoted=!!room.players.find(p=>p.id===socket.id)?.pickerVoted;
 $("picker-options").innerHTML=activePlayers().map(p=>`<button class="vote-option" data-picker="${p.id}" ${hasPickerVoted?"disabled":""}>${avatar(p.id)}<span>${escapeHtml(p.name)}${p.id===socket.id?" (you)":""}</span></button>`).join("");
 $("picker-options").querySelectorAll("[data-picker]").forEach(btn=>btn.onclick=async()=>{const r=await emitAck("word-picker:vote",{targetId:btn.dataset.picker});if(!r.ok)toast(r.error||"Vote failed");else toast("Word-setter vote submitted")});
}
function renderWordEntry(){
 const allowed = room.wordPickerId === socket.id;
 $("word-entry-form").classList.toggle("hidden", !allowed || !!privateInfo?.word);
 $("word-entry-hint").textContent = allowed ? (privateInfo?.word ? "Word submitted. Waiting for the host." : "You were chosen! Type any word you like.") : "The selected innocent player is choosing a word. You won't see it yet.";
 $("word-entry-copy").textContent = allowed ? "You are the secret word setter. Your word will be shown privately to regular players." : "The room voted for a secret word setter. The chosen player is typing a word now.";
}
function renderPickerResults(){
 $("picker-result-title").textContent="Word setter selected!";
 $("picker-result-copy").textContent=`${room.wordPickerName||"The selected player"} is the next word setter and is protected from being an impostor next round.`;
 setButtonHostHint("start-next-round","picker-host-hint","Only the host can start the next round.");
}
function escapeHtml(str){return String(str??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

// WebRTC voice mesh. Best for small rooms; production voice should use an SFU for larger rooms.
$("mic-toggle").onclick=async()=>{
 if(!micStream){
  try{micStream=await navigator.mediaDevices.getUserMedia({audio:true});$("mic-toggle").textContent="Mute mic";$("voice-status").textContent="Microphone on — connecting to room";await connectVoice();}
  catch(e){toast("Microphone permission is needed. Use HTTPS or localhost.");$("voice-status").textContent="Mic unavailable — check browser permissions";}
 }else{
  const enabled=micStream.getAudioTracks()[0]?.enabled;
  micStream.getAudioTracks().forEach(t=>t.enabled=!enabled);
  $("mic-toggle").textContent=enabled?"Unmute mic":"Mute mic";
  $("voice-status").textContent=enabled?"Microphone muted":"Microphone on";
 }
};
async function connectVoice(){
 if(!room)return;
 for(const p of room.players){if(p.id!==socket.id&&p.connected)await createPeer(p.id,true)}
 $("voice-status").textContent="Microphone on — peer voice connections starting";
}
async function createPeer(targetId,initiator){
 if(peers.has(targetId))return peers.get(targetId);
 const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});peers.set(targetId,pc);
 micStream?.getTracks().forEach(t=>pc.addTrack(t,micStream));
 pc.onicecandidate=e=>{if(e.candidate)socket.emit("voice:signal",{targetId,signal:{candidate:e.candidate}})};
 pc.ontrack=e=>{let audio=document.getElementById("audio-"+targetId);if(!audio){audio=document.createElement("audio");audio.id="audio-"+targetId;audio.autoplay=true;document.body.append(audio)}audio.srcObject=e.streams[0]};
 pc.onconnectionstatechange=()=>{if(pc.connectionState==="failed"||pc.connectionState==="closed"){pc.close();peers.delete(targetId)}};
 if(initiator){const offer=await pc.createOffer();await pc.setLocalDescription(offer);socket.emit("voice:signal",{targetId,signal:{description:pc.localDescription}})}
 return pc;
}
socket.on("voice:signal",async({fromId,signal})=>{
 try{
  const pc=await createPeer(fromId,false);
  if(signal.description){
   await pc.setRemoteDescription(signal.description);
   if(signal.description.type==="offer"){const answer=await pc.createAnswer();await pc.setLocalDescription(answer);socket.emit("voice:signal",{targetId:fromId,signal:{description:pc.localDescription}})}
  }else if(signal.candidate){await pc.addIceCandidate(signal.candidate)}
 }catch(e){console.warn("Voice signaling issue",e)}
});
