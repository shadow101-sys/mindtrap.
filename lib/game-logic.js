"use strict";

function countVotes(votes) {
  const counts = new Map();
  let skipped = 0;

  for (const vote of votes || []) {
    if (!vote || !vote.targetId) {
      skipped += 1;
      continue;
    }
    counts.set(vote.targetId, (counts.get(vote.targetId) || 0) + 1);
  }

  const highest = Math.max(0, ...counts.values());
  const leaders = highest > 0
    ? [...counts.entries()].filter(([, count]) => count === highest).map(([playerId]) => playerId)
    : [];

  return {
    counts,
    skipped,
    highest,
    leaders,
    eliminatedId: leaders.length === 1 ? leaders[0] : null,
    tied: leaders.length > 1
  };
}

function groupVoteCounts(votes, players) {
  const names = new Map((players || []).map(player => [player.id, player.name]));
  const { counts, skipped } = countVotes(votes);
  return {
    skipped,
    groups: [...counts.entries()]
      .map(([playerId, count]) => ({
        playerId,
        playerName: names.get(playerId) || "Player",
        count
      }))
      .sort((a, b) => b.count - a.count || a.playerName.localeCompare(b.playerName))
  };
}

function maxBalancedImpostors(playerCount, shadowEnabled, hardLimit = 4) {
  if (!Number.isInteger(playerCount) || playerCount < 3) return 0;
  const setterAndRoleLimit = playerCount - (shadowEnabled ? 2 : 1);
  return Math.max(0, Math.min(hardLimit, Math.floor((playerCount - 1) / 2), setterAndRoleLimit));
}

function assignRoles(players, impostorCount, shadowEnabled, randomUnit = Math.random) {
  if (!Array.isArray(players) || players.length < 3) {
    throw new RangeError("At least three players are required.");
  }

  const available = [...players];
  const roles = {};
  const pick = () => {
    if (!available.length) throw new RangeError("Not enough players for this role setup.");
    const value = Number(randomUnit());
    const safeValue = Number.isFinite(value) ? Math.min(.999999999, Math.max(0, value)) : 0;
    const index = Math.floor(safeValue * available.length);
    return available.splice(index, 1)[0];
  };

  if (shadowEnabled) roles[pick().id] = "shadow";
  const wordSetter = pick();
  roles[wordSetter.id] = "innocent";

  const requestedImpostors = Number(impostorCount);
  const remainingNonImpostors = players.length - requestedImpostors;
  if (!Number.isInteger(requestedImpostors) || requestedImpostors < 1
      || requestedImpostors > available.length || requestedImpostors >= remainingNonImpostors) {
    throw new RangeError("The role setup needs an Innocent word setter and must not start with Impostor parity.");
  }

  for (let index = 0; index < requestedImpostors; index++) {
    roles[pick().id] = "impostor";
  }
  for (const player of available) roles[player.id] = "innocent";

  return { roles, wordSetterId: wordSetter.id };
}

function canSetWord(role) {
  return role === "innocent";
}

function personalOutcome(role, winnerRole) {
  if (!role || !winnerRole) return null;
  if (winnerRole === "shadow") return role === "shadow" ? "victory" : "defeat";
  if (winnerRole === "impostors") return role === "impostor" ? "victory" : "defeat";
  if (winnerRole === "innocents") return role === "innocent" ? "victory" : "defeat";
  return null;
}

module.exports = { countVotes, groupVoteCounts, maxBalancedImpostors, assignRoles, canSetWord, personalOutcome };
