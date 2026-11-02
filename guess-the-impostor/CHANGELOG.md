# MINDTRAP update notes

## Updated source package

- Keep the secret word visible for Innocents and the Shadow during ready, clues, voting, and waiting phases; Impostors never receive the word.
- Show a loading state until the server sends the player's private role; do not guess that the player is Innocent.
- Restrict the word setter to a connected Innocent.
- Add server-side clue unsubmit/edit while the clue phase remains open.
- Add grouped vote totals, vote-skip handling, tie handling, and visible vote bars.
- Add personalized Victory/Defeat results and the Shadow's independent solo win.
- Add phase timers and AFK handling for word entry, ready, clues, and voting.
- Pause the game when fewer than two active players are connected, then resume after rejoin.
- Keep voice peer connections active when a player mutes their own microphone; microphone mute affects sending, not listening.
- Add local mute controls, animated microphone slashes, animated writing dots, and two Cuby result characters.
- Redesign the lobby and game screens with a Neon Noir palette and responsive layout.
- Add room/chat/voice-event rate limits, origin checks, room cleanup, and a health endpoint.
- Update deployment and future-feature documentation to match the implementation.

## Verification

Use `npm run check` and `npm test` from this folder. Browser-based multi-device/WebRTC testing is still required before public deployment. Three.js and GSAP are optional CDN resources; the Cuby has a canvas fallback if Three.js or WebGL is unavailable.
