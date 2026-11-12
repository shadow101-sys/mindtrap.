# Future feature notes: camera + private secret sound

Camera sharing and private secret-sound events are **not implemented** in the current build. The current source includes microphone voice, chat, phase timers, clue editing, vote skipping, reconnecting while the server process is alive, and Cuby result animations.

## Current role identifiers

The server uses these exact role strings:

- `innocent`
- `impostor`
- `shadow`

There is no `player` role. If a future secret sound is intended for the non-Impostor side, explicitly define whether that means `innocent` only or both `innocent` and `shadow`. The Shadow is a separate winning side even though it knows the word.

## Camera feature outline

Use a separate camera stream. Do not request camera permission automatically; ask only after a player clicks an explicit camera control.

```js
let cameraStream = null;

async function enableCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false
    });
    const video = document.getElementById("local-camera");
    if (video) video.srcObject = cameraStream;
  } catch (error) {
    console.warn("Camera access failed.", error);
    toast("Allow camera access to turn on your camera.");
  }
}

function stopCamera() {
  cameraStream?.getTracks().forEach(track => track.stop());
  cameraStream = null;
  const video = document.getElementById("local-camera");
  if (video) video.srcObject = null;
}
```

A local preview alone does not send video to other players. Remote video requires adding video transceivers to the WebRTC negotiation and designing bandwidth controls, privacy indicators, and reconnect handling. Keep camera tracks separate from microphone tracks.

## Private secret-sound outline

Do not broadcast a private sound event to the entire Socket.IO room. Choose an exact sound file from a server-side allow-list, then send the event directly to the intended connected players using each player's current `socketId`.

For both Innocents and the Shadow to receive the sound, the role filter would be:

```js
function sendSecretSoundToNonImpostors(room, soundFile) {
  for (const player of room.players) {
    const role = room.roles[player.id];
    if (player.connected && player.socketId && (role === "innocent" || role === "shadow")) {
      io.to(player.socketId).emit("secret-sound:play", { file: soundFile });
    }
  }
}
```

Do not accept arbitrary file paths or filenames from a client. Use an allow-list of exact sound assets and trigger the event only in a phase where the sound is allowed. Keep secret sounds separate from WebRTC microphone audio, or the Impostor may hear them through voice chat.

A client-side receiver should validate that the received path matches the expected secret-sound directory before creating an `Audio` object. Treat this as game secrecy, not DRM: a modified client can inspect its own browser traffic. Do not use it to distribute sensitive or licensed material.

## Timer settings in this build

Current server defaults are 90 seconds for word entry, 45 seconds for ready, 90 seconds for clues, and 60 seconds for voting. There is no 20-second turn timer in the current implementation.
