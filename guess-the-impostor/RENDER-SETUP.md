# MINDTRAP deployment notes (GitHub + Render)

## Repository layout

The GitHub repository root contains the `guess-the-impostor` folder. In Render, set:

- Service type: **Web Service**
- Runtime: **Node**
- Branch: `main`
- Root Directory: `guess-the-impostor`
- Build Command: `npm install`
- Start Command: `npm start`
- Health check path (optional): `/health`

The service listens on `0.0.0.0` and uses Render's `PORT` environment variable.

## Voice chat

The game uses peer-to-peer WebRTC audio. Both players must allow microphone access and click **Enable mic**. It uses public Google STUN servers by default, which works on some networks but is not reliable behind every router, mobile carrier, school network, or strict firewall.

For more reliable voice, configure a TURN service and add these Render environment variables:

- `TURN_URLS`: comma-separated TURN URLs, e.g. `turn:turn.example.com:3478,turns:turn.example.com:5349`
- `TURN_USERNAME`: TURN username
- `TURN_CREDENTIAL`: TURN password/credential

Use a reputable TURN provider or your own secured coturn server. Important: WebRTC clients must receive TURN credentials, so the `/runtime-config.js` response makes the configured username and credential visible to players using the site. Use short-lived, limited TURN credentials from a provider or token-based TURN service; never expose an administrator password or a permanent high-privilege credential. Do not commit credentials to GitHub. For large rooms, a WebRTC SFU is more scalable than a full mesh. This project is designed for small friend groups.

## Local test

From inside the `guess-the-impostor` folder:

```bash
npm install
npm start
```

Open `http://localhost:3000`. Open the site in multiple browsers/devices to test the room. Microphone permission works on `localhost`; deployed mic access requires HTTPS (Render supplies HTTPS on its public URL).

## Updating after code changes

From the repository root (the folder containing `.git`):

```bash
git add .
git commit -m "Update MINDTRAP"
git push
```

Render can auto-deploy after the push if Auto-Deploy is enabled.

## Notes

- Rooms and chat history live in server memory and are erased if the Render instance restarts or sleeps.
- Render Free instances can sleep while idle; the first visit after sleeping may take time to wake.
- This is a small-room prototype, not hardened for public competitive play. It has no persistent database, account system, or reconnect/session restoration.
- Do not use Live Server to test multiplayer. Run `npm start` so Socket.IO and server timers are active.
