# MINDTRAP

A multiplayer word-and-deduction game built with Node.js, Express, Socket.IO, and WebRTC.

## Run locally

1. Install Node.js 18 or newer.
2. From this folder, run `npm install` and then `npm start`.
3. Open `http://localhost:3000` in a modern browser.
4. Create a room and share its six-character code.

Use the Node server for multiplayer; VS Code Live Server does not run Socket.IO.

## How a match works

1. The host chooses the player limit, Impostor count, and whether to include a Shadow.
2. The server assigns roles and privately chooses a non-Impostor word setter.
3. Innocents and the Shadow see the secret word. Impostors do not.
4. Every connected player marks ready. The clue phase opens when everyone is ready.
5. Each connected player writes and locks one clue. Clues stay hidden until every connected player submits.
6. Discuss the revealed clues and vote for another active player. Votes and voter identities stay private until all connected players have voted.
7. Results reveal the vote choices and the eliminated player's role. If the match continues, the next clue round begins automatically with the same word and roles.
8. A new match resets the roles and selects a new word.

There are no gameplay countdowns. A player's local chat and voice controls do not affect other players.

## Roles and wins

- **Innocent:** knows the word; wins with the Innocents when every Impostor is eliminated.
- **Impostor:** does not know the word; wins when Impostors equal or outnumber all other living players, including the Shadow.
- **Shadow (optional):** knows the word and wins alone if uniquely receiving the most votes and being eliminated.

A tied vote eliminates nobody. The Shadow cannot also be an Impostor.

## Voice, chat, and reconnecting

Chat works in the lobby and during a match. To talk, each player must click **Enable mic** and grant browser permission. The host can remove offline players; players who disconnect can rejoin from the same browser using their saved room session. Voice uses a peer-to-peer WebRTC mesh for small rooms. STUN is configured by default; set `TURN_URLS`, `TURN_USERNAME`, and `TURN_CREDENTIAL` for a TURN service on Render.

Rooms are stored in server memory and disappear when the server restarts. Keep rooms small; use an SFU for larger games.

## Deployment

The GitHub repository contains this project in `guess-the-impostor`. In Render, set the Root Directory to `guess-the-impostor`, Build Command to `npm install`, and Start Command to `npm start`. The server exposes `/health` for health checks. See [RENDER-SETUP.md](./RENDER-SETUP.md) for voice configuration.

## Audio

See [public/assets/audio/README.txt](./public/assets/audio/README.txt) for the available music and sound-effect files.
