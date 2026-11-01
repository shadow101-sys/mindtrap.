# Planned feature: camera + secret sound for regular players

This feature is intentionally not switched on in the current build. The current update focuses on making rooms, word entry, 20-second turns, discussion, votes, chat, and microphone voice work first.

## Intended behavior

- Every player can explicitly enable their camera using the browser's camera permission prompt.
- Normal microphone voice remains available to every player, including eliminated players.
- At a random moment chosen by the server, all **regular players only** receive an instruction to play a secret sound locally.
- The impostor receives no secret-sound event and must not receive the secret sound file URL or name.
- The secret sound is separate from microphone audio. Do not mix it into the microphone track, or the impostor will hear it through voice chat.

## Where camera code belongs

The current mic function is in `public/app.js`, in `enableMic()`. Add a separate camera stream there rather than changing the microphone stream:

```js
let cameraStream = null;

async function enableCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false
    });
    document.getElementById("local-camera").srcObject = cameraStream;
  } catch (error) {
    toast("Allow camera access to turn on your camera.");
  }
}
```

Add this video element to `public/index.html` in the game voice/video panel:

```html
<video id="local-camera" autoplay muted playsinline></video>
```

Add an explicit **Enable camera** button and call `enableCamera()` only after the player clicks it. Stop `cameraStream.getTracks()` when the player leaves the room.

## Where the secret-sound event belongs

Do not broadcast a secret-sound event to the whole Socket.IO room. Add a server event in `server.js` that sends it only to players whose server-side `room.roles[player.id] === "player"`:

```js
function sendSecretSoundToRegulars(room, soundFile) {
  for (const player of activePlayers(room)) {
    if (room.roles[player.id] === "player") {
      io.to(player.id).emit("secret-sound:play", { file: soundFile });
    }
  }
}
```

Choose `soundFile` randomly from an allow-listed array on the server. Do not accept a sound filename from a client. Trigger this only during a game phase where the sound is allowed.

In `public/app.js`, receive the event and play it locally:

```js
socket.on("secret-sound:play", ({ file }) => {
  if (typeof file !== "string" || !file.startsWith("/assets/secret-sounds/")) return;
  const audio = new Audio(file);
  audio.play().catch(() => toast("Tap the page to allow sound playback."));
});
```

Place your sound files in `public/assets/secret-sounds/` and use a server-side allow-list of exact filenames. Keep those sounds separate from WebRTC mic tracks.

## Important limitation

This design keeps the sound event away from impostor sockets in the normal game flow, but a modified client can inspect its own browser traffic. It is game secrecy, not DRM or a security boundary. Camera and microphone must always be enabled only after clear player consent.
