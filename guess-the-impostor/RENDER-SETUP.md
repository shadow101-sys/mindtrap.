# MINDTRAP deployment notes (GitHub + Render)

## Render settings

- Service type: **Web Service**
- Runtime: **Node**
- Branch: your deployment branch (commonly `main`)
- Root Directory: the folder containing this project's `package.json` (for a nested repository, `guess-the-impostor`)
- Build Command: `npm install`
- Start Command: `npm start`
- Health check path: `/health`

The server listens on `0.0.0.0` and uses Render's `PORT` environment variable.

## Allowed origins

The server accepts same-origin browser requests and the local development origins `http://localhost:3000` and `http://127.0.0.1:3000`. When hosting the client separately from the server, set `ALLOWED_ORIGINS` to a comma-separated list of exact trusted origins, including their scheme, for example:

```text
https://your-game.example,https://www.your-game.example
```

Do not use a wildcard for a public deployment.

## Voice chat / TURN

The game uses peer-to-peer WebRTC audio for small rooms. Each player must click the microphone control and grant browser permission. Muting your own microphone disables your outgoing audio track but keeps the peer connections open for listening. Players can also mute another player's incoming audio locally.

Google STUN servers are configured by default. STUN alone is not reliable on every router, mobile carrier, school network, or strict firewall. For more reliable connectivity, configure a TURN service with these environment variables:

- `TURN_URLS`: comma-separated TURN URLs, e.g. `turn:turn.example.com:3478,turns:turn.example.com:5349`
- `TURN_USERNAME`: TURN username
- `TURN_CREDENTIAL`: TURN credential

The `/runtime-config.js` endpoint sends the ICE server configuration to browsers. TURN credentials are therefore visible to users of the game. Use short-lived, restricted credentials from a TURN provider or token-based TURN service. Never expose an administrator password or permanent high-privilege credential, and do not commit secrets to GitHub.

A full mesh creates a peer connection for each pair of players. For larger rooms, use a WebRTC SFU. This project is intended for small friend groups.

## Local testing

From this project folder:

```bash
npm install
npm run check
npm test
npm start
```

Open `http://localhost:3000` in several browsers or devices. Browser microphone permission works on `localhost`; deployed microphone access requires HTTPS, which Render provides on its public URL. VS Code Live Server does not run the Socket.IO backend and must not be used for multiplayer testing.

## Updating the deployment

From the Git repository root:

```bash
git add .
git commit -m "Update MINDTRAP"
git push
```

Render can redeploy automatically after the push if Auto-Deploy is enabled.

## Runtime limitations

- Rooms, chat history, game state, and rejoin sessions are stored in server memory. A reconnect works while the same process and room remain alive, but a server restart clears them.
- Rooms are cleaned up ten minutes after every player has disconnected.
- There is no persistent database or account system.
- `FUTURE-CAMERA-SECRET-AUDIO.md` documents ideas that are not implemented in this build.
