# MINDTRAP

MINDTRAP is a small-room multiplayer hidden-role word game built with Node.js, Express, Socket.IO, and WebRTC. The client uses vanilla JavaScript, CSS animations, GSAP 3.15.0 motion, and a Three.js Cuby renderer with a lightweight canvas fallback.

## Run locally

1. Install Node.js 18 or newer.
2. Open a terminal in this project folder (the folder containing `package.json`).
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:3000` in a modern browser.
6. Create a room and share its six-character code. Open the site in separate browsers or devices to test multiplayer.

Do not use VS Code Live Server for multiplayer testing. Live Server does not run the Express server, Socket.IO events, room timers, or server-side game rules.

Useful commands:

```bash
npm run check
npm test
npm start
```

## Match flow

1. The host chooses the room size, Impostor count, and optional Shadow.
2. At least three players must be connected. Offline lobby players must be removed before the host can start, so roles are never assigned to ghost players.
3. The server assigns roles. One connected Innocent is selected as the word setter. Neither the Impostor nor the Shadow can be selected.
4. The word setter privately submits a word. Innocents and the Shadow receive it privately; the Impostor does not.
5. The identity card stays visible through the ready, clue, voting, and temporary waiting phases. A missing private role is shown as loading rather than incorrectly assuming the player is Innocent.
6. Players mark ready. If the ready timer expires, connected active players are marked ready automatically.
7. Each active player writes a clue. Submitted clues can be unsubmitted and edited while the clue phase remains open. The server locks editing once voting begins. If the clue timer expires, missing clues are automatically filled with the saved draft or `No clue submitted.`
8. Clues are revealed, then each connected active player votes for another active player or skips. A skipped vote is counted separately and does not add to a player's vote total. A unique highest vote eliminates that player; a tie eliminates nobody.
9. Vote results are grouped by player and show totals such as `×2` and `×3`. If the match continues, a new clue round begins with the same roles and word.
10. If fewer than two active players are connected during a match, the match pauses. It resumes when enough players reconnect. Reconnecting players receive their current private state.
11. The host can start a new match after the result screen. Roles, word, clues, votes, and results are reset.

## Roles and win conditions

- **Innocent:** knows the word, can be selected as the word setter, and wins when every Impostor is eliminated.
- **Impostor:** does not know the word and wins when the living Impostors equal or outnumber all other living players, including the Shadow.
- **Shadow (optional):** knows the word, cannot be the word setter, and wins alone when the Shadow is uniquely voted out. If the Impostors win by parity or the Innocents eliminate every Impostor, the Shadow loses.

## Voice and chat

- Chat works in the lobby and during the match, including for eliminated players.
- Players must explicitly enable their microphone and grant browser permission. Microphone mute only stops the local outgoing track; the voice connections remain available so a muted player can keep listening.
- Each player can locally mute another player's incoming audio without affecting that player's microphone for everyone else.
- Eliminated players remain in the room and can continue using chat and voice.
- Voice uses a peer-to-peer WebRTC mesh intended for small rooms. Google STUN is configured by default. Some networks require a TURN server; see `RENDER-SETUP.md`.

## Timers and AFK handling

Default phase timers are 90 seconds for word entry, 45 seconds for ready, 90 seconds for clues, and 60 seconds for voting. Word entry rotates to another connected Innocent when possible. Ready timeouts auto-mark connected active players ready, clue timeouts submit a saved draft or placeholder, and voting timeouts count missing votes as skips.

## Design and animation

The visual system uses a dark Neon Noir palette with violet for primary actions, cyan for Innocent-related elements, coral for Impostor, gold for Shadow, and green for success. Typing dots, microphone slash transitions, player cards, vote bars, overlays, and result titles use CSS/GSAP animation.

Three.js 0.187.0 is loaded from a CDN for the two 3D Cuby characters on the Victory/Defeat screen. If the CDN or WebGL is unavailable, the game uses an animated canvas fallback. Internet access is needed for the optional CDN libraries and hosted fonts; core game logic does not depend on Three.js or GSAP.

## Runtime and limitations

- Room state, chat history, and reconnect tokens are held in server memory. Rejoining works while the same server process and room still exist. A server restart clears rooms and invalidates those sessions.
- Rooms with no connected players are removed after ten minutes.
- There is no account system, database persistence, or camera/secret-sound feature in this build.
- WebRTC mesh voice becomes less suitable as room sizes grow. Use an SFU for larger rooms.
- This is a private-room prototype, not a hardened public competitive service. Continue testing before opening it to unknown users.

## Deployment

For Render settings, environment variables, TURN setup, and update commands, see `RENDER-SETUP.md`.

## Audio assets

No MP3 files are included in this source package. Optional file names and locations are listed in `public/assets/audio/README.txt`. The game remains usable without them; missing sound effects are silently skipped and missing background music displays a notice.
