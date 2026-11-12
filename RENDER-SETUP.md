# MINDTRAP — Render setup

A `render.yaml` Blueprint is included at this project root. It creates one Node web service and one Postgres database, both in Singapore, and injects the database's internal connection string as `DATABASE_URL`.

## Deploy through GitHub

1. Make sure the MINDTRAP application files (`package.json`, `server.js`, `lib/`, `public/`, `test/`, and `render.yaml`) are at the Git repository root. The original Git repo may still nest the app in `guess-the-impostor/`; the updated handoff ZIP groups the app under `MINDTRAP/`. Copy the updated app into the existing repository root, compare and preserve unrelated files, and regenerate the root lockfile.
2. Push the tested project to the GitHub `main` branch.
3. In Render, choose **New → Blueprint**, connect the GitHub repository, and select its `render.yaml`.
4. Review the resources and plans before applying. The included Blueprint sets both service and Postgres to `free` to avoid silently creating paid resources.
5. Render connects `DATABASE_URL` to the database in the same region through a private/internal URL.
6. After the first deploy, open the Web Service URL and confirm `/health` returns `ok: true` with `"database": "connected"`.

Current deployment configuration:
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check: `/health`
- Region: Singapore
- Single web instance: required until Socket.IO and live-room state are shared across instances.

## Important Free-plan limits

Render documents that Free Postgres has 1 GB of storage, no backups, and expires 30 days after creation. There is a 14-day grace period to upgrade after expiry; after that Render deletes the database and its data. Free web services spin down after 15 minutes without inbound traffic and may take about a minute to wake up. For data you intend to keep, upgrade Postgres to a paid plan before the expiration date. Review current prices in your Render Dashboard before confirming.

## Microphone / TURN

Render serves the application over HTTPS, which is required for microphone capture outside localhost. Browser users must still click the microphone button and grant permission.

STUN is configured by default. For networks where STUN is insufficient, obtain a TURN service and add these variables in the Render Web Service environment:
- `TURN_URLS`
- `TURN_USERNAME`
- `TURN_CREDENTIAL`

Use short-lived, restricted TURN credentials. The existing runtime config sends ICE credentials to game clients, so never use a permanent, high-privilege TURN password.

## Health and persistence

`/health` verifies the PostgreSQL connection when `DATABASE_URL` is set. The server creates `mindtrap_room_snapshots` at startup. Active rooms, current phase data, chat history, and hashed rejoin tokens are persisted. Raw rejoin tokens and player roles are not sent in public `room:update` payloads.

Room snapshots do not make the live server multi-instance safe. Keep one web instance; for horizontal scaling, first add a Socket.IO Redis adapter and distributed room ownership/coordination.
