# MINDTRAP

MINDTRAP is a multiplayer hidden-role word game, upgraded with a procedural Three.js first-person station. It uses Node.js, Express, Socket.IO, server-authoritative game rules, and WebRTC room voice.

## What is in this build

- **First-person 3D station:** walk around a lit sci-fi meeting station, look with the mouse, sprint, and use touch movement on supported mobile browsers.
- **Synchronized multiplayer movement:** player positions and facing direction are sent through Socket.IO and clamped by the server. Other players appear as animated crew avatars with name labels.
- **Open room voice:** the existing WebRTC mesh voice remains available to all connected room members. Microphone access is opt-in and browser permission is required; players can mute themselves or locally mute another player.
- **Original deduction rules are preserved:** Innocent / Impostor / optional Shadow roles, private word assignment, ready phase, clue submission/editing, voting, skip votes, ties, elimination, and win conditions remain server-authoritative.
- **Persistent room snapshots:** when `DATABASE_URL` is configured, the app stores room snapshots and chat history in PostgreSQL. Rejoin token hashes are stored; raw rejoin tokens are not.
- **Health endpoint:** `/health` reports app and database availability.

## Run locally

1. Install Node.js 18 or newer.
2. Open a terminal in the project folder (the folder containing `package.json`).
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:3000`.
6. Create a room and share its six-character code. Use separate browsers/devices to test multiplayer.

Useful commands:

```bash
npm run check
npm test
npm start
```

Do **not** use VS Code Live Server for multiplayer testing. Live Server does not run the Express server, Socket.IO events, game rules, room timers, or voice signaling.

## First-person controls

- Click **ENTER FIRST PERSON** to capture the mouse.
- `W A S D` moves; mouse movement looks around.
- `SHIFT` sprints.
- `ESC` releases the mouse.
- On touch devices, drag the 3D scene to look and use the on-screen movement pad.

The 3D room is built from procedural geometry; it does not depend on external 3D asset downloads. Three.js is imported from jsDelivr, so the first-person view needs internet access to load the library. The rest of the app remains usable if the CDN is unavailable.

## Match flow and original rules

1. The host chooses room size, Impostor count, and optional Shadow.
2. At least three connected players must be present; offline lobby players must be removed before the host can start.
3. The server assigns roles. One connected Innocent is selected as word setter. Neither the Impostor nor Shadow can be selected.
4. The word setter privately submits a word. Innocents and the Shadow receive it privately; the Impostor does not.
5. Players mark ready. If the ready timer expires, connected active players are marked ready automatically.
6. Each active player writes a clue. Submitted clues can be unsubmitted and edited while the clue phase remains open. The server locks editing once voting begins.
7. Clues are revealed, then each connected active player votes for another active player or skips. Skips are counted separately. A unique highest vote eliminates that player; a tie eliminates nobody.
8. If the match continues, a new clue round begins with the same roles and word.
9. If fewer than two active players are connected during a match, the match pauses and resumes when enough players reconnect.
10. The host can start a new match after the result screen.

### Roles and win conditions

- **Innocent:** knows the word, can be selected as word setter, and wins when every Impostor is eliminated.
- **Impostor:** does not know the word and wins when the living Impostors equal or outnumber all other living players, including the Shadow.
- **Shadow (optional):** knows the word, cannot be word setter, and wins alone when the Shadow is uniquely voted out. If the Impostors win by parity or the Innocents eliminate every Impostor, the Shadow loses.

## Voice requirements

- Each user must explicitly enable their microphone and grant browser permission.
- Deployed microphone access requires HTTPS (Render provides HTTPS on its public URL).
- STUN is configured by default. Some networks require a TURN provider. Set `TURN_URLS`, `TURN_USERNAME`, and `TURN_CREDENTIAL` in the hosting dashboard. Use short-lived, restricted TURN credentials; do not commit TURN secrets to GitHub.
- Voice uses a peer-to-peer mesh, suitable for small friend groups rather than large public rooms.

## PostgreSQL persistence

Set `DATABASE_URL` to a PostgreSQL connection string. The server creates `mindtrap_room_snapshots` automatically and persists active room snapshots. When the server restarts, players are restored as offline and may rejoin with their saved session token. Empty rooms expire after ten minutes.

Without `DATABASE_URL`, the app still runs locally but room data is memory-only.

## GitHub + Render

A `render.yaml` Blueprint is included. It defines:
- One Node web service (single instance) in the Singapore region.
- One Render PostgreSQL database in the same region.
- A private `DATABASE_URL` service-to-database reference.
- Optional TURN credentials as dashboard-supplied secrets.

The app uses a single Socket.IO server instance because live room coordination currently uses an in-process room map. Do not scale the web service to multiple instances unless a shared Socket.IO adapter (for example Redis) and distributed room coordination are implemented.

The Blueprint currently selects the Render Free plans to avoid silently creating paid resources. **Render Free Postgres is temporary: it expires 30 days after creation and has a 1 GB storage limit.** Upgrade the database to a paid plan before relying on it for long-term data. Free web services also spin down after 15 minutes without inbound traffic. Review Render's current plan/pricing details before deploying.

After moving the app files to the Git repository root:
- Build command: `npm install` (regenerate and commit `package-lock.json`; after it is in sync, `npm ci` is also suitable).
- Start command: `npm start`.
- Health check: `/health`.
- Keep `DATABASE_URL` managed by Render's `fromDatabase` reference; never paste it into source code.

See `RENDER-SETUP.md` and `CODEX-PROMPT.md` for the deployment handoff.

## Audio assets

Original sound effects and background music are stored under `public/assets/audio`. The background track is large; compress or replace it with an appropriately licensed and optimized asset before distributing widely.
