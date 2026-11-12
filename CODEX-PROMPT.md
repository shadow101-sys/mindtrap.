# CODEX TASK — Move MINDTRAP to repository root, verify the 3D multiplayer build, and deploy to GitHub + Render

You are working on the existing MINDTRAP project. Do not replace it with a different game or a generic starter. Preserve the existing game rules and improve the current project in place.

## Project context

The original uploaded Git repository was nested (`guess-the-impostor-updated/guess-the-impostor/`), but the updated handoff ZIP supplied with this prompt contains the application in a single `MINDTRAP/` folder. First inspect the actual workspace and any supplied archive; do not assume either layout. Use the existing Git repository root as the destination, preserve its `.git/` directory and history, and place the updated application files directly at that repository root. Never move, delete, overwrite, or recreate `.git/`. If the updated files are already at the repository root, do not nest them again. If the old nested application is still present, migrate its updated contents to root only after comparing and preserving unrelated changes. The original repository-root `package-lock.json` was an empty placeholder; the app lockfile was stale after adding `pg`, so regenerate it from `package.json` before committing.

The updated application includes:
- `public/world.js`: procedural Three.js first-person station, mouse-look, WASD movement, sprint, mobile touch pad, remote crew avatars, and live position sync.
- `lib/world-logic.js`: deterministic spawn placement and server-side position/rate clamping.
- `lib/database.js`: optional PostgreSQL snapshot persistence and startup restoration.
- `render.yaml`: Render Node web service + Render Postgres Blueprint in Singapore.
- Existing `server.js`, `lib/game-logic.js`, `public/app.js`, and WebRTC voice are still the source of truth for the original match logic.

## Main goals

1. Ensure the actual application files (`package.json`, `server.js`, `lib/`, `public/`, `test/`, `.env.example`, `.gitignore`, `render.yaml`, and documentation) live directly at the Git repository root. Migrate from `guess-the-impostor/` only if that old nested layout still exists; do not create another nested folder when the updated files are already at root.
2. Preserve the original MINDTRAP game mechanics exactly.
3. Ensure first-person 3D walking, mouse look, sprint, remote avatars, and network-synced player positions work for all players in a room.
4. Keep room voice as toggle-on open mic using the existing WebRTC system. It must remain opt-in: each player clicks the mic button and grants browser permission. Preserve listening while muted and local per-player mute.
5. Verify the PostgreSQL snapshot persistence and Render deployment setup.
6. Test the whole project, fix any real bugs found, and only then commit/push/deploy.

## Critical migration rules

- Locate the supplied updated MINDTRAP handoff archive/files and the existing Git working tree. Compare them carefully; use the updated handoff files as the intended 3D/database implementation, but retain unrelated user changes from the working tree.
- First inspect `git status --short`, `git branch --show-current`, and `git remote -v`.
- Do not destroy or discard unrelated user changes. If the worktree has unrelated changes, preserve them and do not reset/clean.
- If the real application is still nested in `guess-the-impostor/`, move its contents into the repository root, including hidden project config files such as `.gitignore` and `.env.example`. If the app is already at root, keep it there. Apply the updated handoff archive's code to the matching app files without overwriting unrelated user work.
- Do NOT move `node_modules/` or any nested `.git/` folder. Do NOT include `.env` or secrets.
- Replace the empty repository-root `package-lock.json` with the actual app lockfile, then regenerate/synchronize it with `package.json` because `pg` was added for PostgreSQL.
- Update all paths and documentation after the move. The final Render Root Directory must be the repository root (`.` / blank in Render), not `guess-the-impostor`.
- Remove the now-empty nested app folder only after confirming all source, tests, static assets, and documentation have been moved.
- Keep the existing Git remote unless it is proven invalid. The uploaded repository's remote looked unusual (`https://github.com/shadow101-sys/mindtrap..git`); verify it before pushing. Do not silently change it to a guessed URL.

## Game rules that MUST remain unchanged

Read `README.md`, `lib/game-logic.js`, `server.js`, and `test/` before making changes. Preserve:
- 3–15 player rooms and six-character room codes.
- Host room configuration: room size, Impostor count, optional Shadow.
- At least 3 connected players required to start; do not assign roles to offline players.
- One Innocent word setter; Impostor and Shadow must never be selected.
- Secret word private to Innocents and Shadow; Impostor must never receive it.
- Existing ready phase and timer.
- Existing clue phase, draft saving, unsubmit/edit-before-vote, 120-character limit, and automatic timeout behavior.
- Existing vote choices, skip counting, unique-high-vote elimination, tie = no elimination.
- Existing Shadow solo-win condition and team parity/win conditions.
- Existing reconnect/rejoin behavior and pause/resume behavior.
- Eliminated players stay in the room and can still chat/listen to voice.
- New match resets all match-specific state.

Never expose private roles, the secret word, private clue drafts, or raw rejoin tokens in public room updates, logs, or client-facing world events.

## 3D / multiplayer acceptance checklist

- 3D world loads in the room view using the pinned Three.js CDN version; provide a graceful visual status if WebGL or the CDN is unavailable.
- First person is true FPS camera control, not a third-person camera.
- `WASD` moves, mouse changes view, `SHIFT` sprints, `ESC` releases pointer lock.
- Touch users can drag the scene to look and use the on-screen movement pad.
- Movement is smooth and bounded; server validates finite coordinates, world bounds, and movement speed to prevent teleporting.
- Each remote player has a visible avatar and name label. Remote positions and facing direction interpolate smoothly.
- No player's private role is visible through avatar colors, effects, labels, or world events.
- Disconnect/reconnect, late join, room leave, and room changes remove or restore the correct remote avatars.
- Movement updates must be throttled; do not broadcast one Socket.IO event per render frame.
- Mouse look must sync the player's facing direction even when they stand still.
- The 3D canvas must not steal keyboard input while the user is typing into forms or chat.
- The original lobby, roles, clue, vote, chat, timers, results, and voice controls remain usable. Keep the 3D viewport integrated with the existing UI rather than deleting existing game panels.

## Open microphone / WebRTC acceptance checklist

- Mic is off initially and enabled only after a clear user click and browser permission.
- Once enabled, it is open room voice (not push-to-talk) until muted.
- Muting a local mic stops the outgoing track but does not close the peer connection or stop listening.
- Local mute of another player affects only that player's incoming audio for the current browser.
- Peer connections close when a player leaves/disconnects and are recreated on rejoin.
- Preserve deterministic offerer logic and queued ICE candidates.
- Verify HTTPS requirement for microphone use after deployment.
- Keep TURN secrets out of Git. If a TURN provider is configured, use restricted/short-lived credentials only.

## PostgreSQL persistence acceptance checklist

- Keep local development working without `DATABASE_URL` (memory-only local mode is okay).
- When `DATABASE_URL` is present, connect to PostgreSQL, create the required table safely, persist room snapshots and chat changes, and restore them on process restart.
- Persist only hashed rejoin tokens, never raw tokens.
- On restore, mark old sockets disconnected, clear stale voice state, retain safe player/room/game state, and let players rejoin using their local session token.
- Serialize or otherwise order snapshot writes so old concurrent writes cannot overwrite a newer room state.
- Room cleanup must delete the associated database row.
- Database errors should be logged clearly; `/health` must return HTTP 503 if the configured DB is unavailable.
- Add tests for snapshot serialization/restoration and world movement validation where practical.
- Do not claim PostgreSQL makes the app horizontally scalable. Current room coordination is in-process. Keep exactly one web service instance unless a proper Socket.IO Redis adapter and shared room coordination are implemented.

## Test and repair workflow

After moving the app to the repository root:
1. Run `npm install` to synchronize dependencies and regenerate `package-lock.json`.
2. Run `npm run check`.
3. Run `npm test`.
4. Start the app locally with no `DATABASE_URL`; confirm it boots and `/health` reports database `disabled`.
5. If a local PostgreSQL service is available, test with `DATABASE_URL`; otherwise do not fake this test. State what was and was not verified.
6. Test two or more browser sessions in one room: join, move in the 3D world, see remote avatars move, test mic on/off, chat, roles, clues, voting, ties, game result, rejoin.
7. Inspect browser console and server logs; fix errors and warnings caused by this project.
8. Run a final `git diff --check`, review the diff, and make sure `.env`, secrets, `node_modules`, build output, and personal files are not staged.

Do not claim the voice or multi-browser test passed unless you actually performed it.

## Render deployment requirements

Use the included `render.yaml` as a Render Blueprint. Verify it against Render's current Blueprint specification before deploying.

Expected Render configuration after migration:
- One Node Web Service named `mindtrap`.
- One Render Postgres DB named `mindtrap-db`.
- Both in `singapore`.
- `DATABASE_URL` uses Render's `fromDatabase` reference (internal URL).
- Build: `npm install` (or switch to `npm ci` only after the lockfile is verified in sync).
- Start: `npm start`.
- Health path: `/health`.
- Environment: `NODE_ENV=production`.
- TURN variables are optional dashboard secrets: `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL`.
- One web instance only until horizontal scaling architecture exists.

The Blueprint currently uses Free plans to avoid unexpected paid resources. Explicitly warn me that Render Free Postgres has a 1 GB limit and expires after 30 days; data can be deleted after its expiry/grace period. Ask for my choice only if a paid plan must be selected before actually creating billable resources. Never create paid infrastructure without my explicit approval.

After GitHub is updated:
- Connect the existing GitHub repository in Render.
- Create/sync the Blueprint from the root `render.yaml`.
- Check Render build/deploy logs.
- Verify `https://<service>.onrender.com/health` returns `{"ok":true,"service":"mindtrap","database":"connected"}`.
- Open the deployed app and test Socket.IO/WebSocket connection, room creation/joining, 3D movement, chat, and microphone permission.
- If Render login/CLI permissions are unavailable, do not fake a deployment; finish the code and give me the exact remaining dashboard steps.

## GitHub push rules

- Never put credentials or database URLs into Git.
- Do not overwrite `origin` or force-push.
- If the existing `origin` is valid and authenticated, and all tests pass, stage only intended app files, commit with a descriptive message, and push the current intended branch.
- If the existing origin is malformed or inaccessible, stop before pushing and explain the exact issue; do not invent a repository URL.

## Final response required from you

Give me:
1. A summary of what changed.
2. The exact test commands and their real results.
3. The GitHub branch/commit/push status.
4. The Render service/database status and live URL only if actually deployed.
5. Any missing secrets or manual steps (TURN, Render DB upgrade, etc.).
6. Any limitations that remain.

Do not stop after moving files. Do not make a mockup-only implementation. Make the running game work end-to-end and be honest about anything you could not verify.
