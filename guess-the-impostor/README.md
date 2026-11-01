# MINDTRAP — Find the Impostor

A small-room online social deduction game built with Node.js, Express, Socket.IO, and browser WebRTC.

## Requirements
- Node.js 18 or newer
- A modern browser
- At least 3 players to start a room
- Microphone permission for voice chat

## Run locally
1. Extract the project.
2. Open a terminal inside the `guess-the-impostor` folder.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:3000`.
6. Open the same URL in other browsers or devices to test multiplayer.

Do not use VS Code Live Server for multiplayer testing. Live Server only previews the static front end; `npm start` runs the actual Socket.IO game server and server-controlled timers.

## Game flow
1. The host starts the game.
2. The server privately selects a random word-setter who is guaranteed to be a regular player.
3. The selected player types a secret word. This step has **no timer**.
4. Regular players receive the word privately; impostors receive no word.
5. The host begins the clue phase. Speaking order is shuffled and each player gets **20 seconds**. If a turn expires, the server records a missed turn and advances automatically.
6. Discussion lasts **60 seconds**. The host can start voting early; otherwise voting starts automatically.
7. Voting lasts **30 seconds** and resolves automatically, even if someone does not vote.
8. After results, the host starts a vote for the next word-setter. A tie is broken randomly; if no one votes, the server chooses a random active player.
9. The elected next word-setter is guaranteed not to be an impostor in the next round.

The current word-setter's identity is not included in public room updates. Eliminated players remain in the room and can still use chat and voice.

## Current features
- Create and join rooms with a six-character code
- Host settings for player limit and impostor count
- Server-side random impostor assignment
- Private role and secret-word delivery
- Hidden current word-setter identity
- 20-second server-controlled clue turns with animated client timer
- 60-second discussion timer and automatic transition to voting
- 30-second voting timer and automatic resolution
- Next word-setter vote and next-round protection
- Live room chat with a short in-memory history
- WebRTC microphone voice for small rooms
- Animated lobby mascot, character avatars, timer effects, responsive layout
- Optional user-supplied music and sound-effect file slots

## Voice chat notes
Voice uses a peer-to-peer WebRTC mesh. Every player must click **Enable mic** and allow browser microphone access. STUN servers are included, but STUN alone cannot connect every network. For better reliability, configure a TURN server using the environment variables described in `RENDER-SETUP.md`. TURN credentials are delivered to players' browsers, so use short-lived/limited credentials, never an administrator password. The mesh is intended for small friend groups, not large public rooms.

## Audio files
Read `public/assets/audio/README.txt` for the audio filenames and controls. Add only music and effects that you own or have permission to publish.

## Planned camera + secret-sound feature
The camera and impostor-excluded sound feature is not enabled in this build. See `FUTURE-CAMERA-SECRET-AUDIO.md` for the planned approach and the exact locations for the future code.

## Prototype limitations
- Room state and chat history are kept in memory. Restarting or sleeping/restarting the server clears rooms.
- There is no account system or robust reconnection/session restoration. A disconnected player must rejoin a lobby.
- Voice mesh uses one peer connection per pair, so keep rooms small. A TURN service is recommended for broader network compatibility; an SFU is preferable for larger rooms.
- This is a prototype. Add persistent storage, abuse/rate limiting, stronger reconnection handling, and production monitoring before making it a large public game.
