# MINDTRAP — Guess the Impostor

A no-database online multiplayer prototype using HTML, CSS, JavaScript, Node.js, Socket.IO, and WebRTC.

## Requirements
- Node.js 18 or newer
- A modern browser
- Microphone permission for voice chat

## Run locally
1. Extract the project folder.
2. Open a terminal inside `guess-the-impostor`.
3. Run `npm install`
4. Run `npm start`
5. Open `http://localhost:3000`
6. Open the same address in other browser tabs/devices connected to the same network. For a phone, use your computer's LAN IP address and allow the port through the firewall.

## Current prototype features
- Create/join room with a six-character room code
- Host-controlled start, room size, impostor count
- Secret word and private role sent individually by Socket.IO
- Random speaking order, one clue per player
- Discussion after all clues
- Private votes, player vote or skip vote
- Results, tie/skip handling, next-word-setter vote
- Word-setter is protected from being an impostor in the next round
- Room chat
- Experimental peer-to-peer WebRTC voice for small rooms
- Responsive UI, animated CSS characters, ambient effects, transitions

## Important prototype limitations
- Rooms are held in memory and disappear when the server restarts.
- Room settings in the lobby are chosen during room creation; the lobby controls are currently display-only after creation.
- This is a prototype, not production-hardened. Add server-side rate limits, reconnection/session handling, robust host controls, and anti-cheat measures before public release.
- WebRTC voice may fail across some networks because this prototype uses STUN only; production deployment should add a TURN server and preferably an SFU for larger rooms.
- Use HTTPS for microphone access when deployed. `localhost` is allowed for local testing.
- The prototype shows the secret word/category privately, but it does not yet implement a separate manual word-picking UI despite the word-setter voting mechanic; the server currently selects a random word.
- Word-setter voting results require every active player to submit a vote. If someone disconnects mid-vote, the vote may stall; reconnect/disconnect handling should be improved.
- This version is a starting point. Test with multiple browsers before sharing it publicly.


## Latest update
- Fixed dynamic Create Room / Join buttons by handling clicks on nested text/icons.
- Added custom word setter entry: the chosen non-impostor player types a word; the server only accepts a submission from the selected setter, and regular players receive the word privately.
