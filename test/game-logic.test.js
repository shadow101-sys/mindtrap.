"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { countVotes, groupVoteCounts, maxBalancedImpostors, assignRoles, canSetWord, personalOutcome } = require("../lib/game-logic");

test("counts grouped votes and identifies one clear elimination", () => {
  const result = countVotes([
    { voterId: "a", targetId: "b" },
    { voterId: "c", targetId: "b" },
    { voterId: "d", targetId: "c" }
  ]);
  assert.equal(result.eliminatedId, "b");
  assert.equal(result.tied, false);
  assert.equal(result.highest, 2);
});

test("a tied vote does not eliminate anyone", () => {
  const result = countVotes([
    { voterId: "a", targetId: "b" },
    { voterId: "d", targetId: "c" }
  ]);
  assert.equal(result.eliminatedId, null);
  assert.equal(result.tied, true);
});

test("skipped votes do not count toward a candidate", () => {
  const result = countVotes([
    { voterId: "a", targetId: null, skipped: true },
    { voterId: "b", targetId: null, skipped: true }
  ]);
  assert.equal(result.skipped, 2);
  assert.equal(result.eliminatedId, null);
  assert.equal(result.tied, false);
});

test("vote summaries are sorted by count and include skip total", () => {
  const players = [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Bravo" }
  ];
  const result = groupVoteCounts([
    { voterId: "x", targetId: "a" },
    { voterId: "y", targetId: "b" },
    { voterId: "z", targetId: "a" },
    { voterId: "w", targetId: null }
  ], players);
  assert.deepEqual(result.groups.map(group => [group.playerName, group.count]), [["Alpha", 2], ["Bravo", 1]]);
  assert.equal(result.skipped, 1);
});

test("personal result respects the independent Shadow win", () => {
  assert.equal(personalOutcome("shadow", "shadow"), "victory");
  assert.equal(personalOutcome("innocent", "shadow"), "defeat");
  assert.equal(personalOutcome("impostor", "impostors"), "victory");
  assert.equal(personalOutcome("innocent", "innocents"), "victory");
  assert.equal(personalOutcome("shadow", "innocents"), "defeat");
});

test("only Innocents can be selected as the word setter", () => {
  assert.equal(canSetWord("innocent"), true);
  assert.equal(canSetWord("impostor"), false);
  assert.equal(canSetWord("shadow"), false);
});


test("role assignment creates one Shadow, the exact Impostor count, and an Innocent setter", () => {
  const players = ["a", "b", "c", "d", "e"].map(id => ({ id }));
  const result = assignRoles(players, 2, true, () => 0);
  const roles = Object.values(result.roles);
  assert.equal(roles.filter(role => role === "shadow").length, 1);
  assert.equal(roles.filter(role => role === "impostor").length, 2);
  assert.equal(roles.filter(role => role === "innocent").length, 2);
  assert.equal(result.roles[result.wordSetterId], "innocent");
  assert.equal(roles.length, players.length);
});

test("role assignment without Shadow leaves the required Innocent setter", () => {
  const players = ["a", "b", "c", "d"].map(id => ({ id }));
  const result = assignRoles(players, 1, false, () => .99);
  assert.equal(Object.values(result.roles).filter(role => role === "impostor").length, 1);
  assert.equal(Object.values(result.roles).filter(role => role === "innocent").length, 3);
  assert.equal(result.roles[result.wordSetterId], "innocent");
  assert.equal(Object.values(result.roles).includes("shadow"), false);
});

test("role assignment rejects starting at Impostor parity", () => {
  const players = ["a", "b", "c"].map(id => ({ id }));
  assert.throws(() => assignRoles(players, 2, false), /must not start with Impostor parity/);
});

test("three-player rooms still keep a word setter and a winnable balance", () => {
  const players = ["a", "b", "c"].map(id => ({ id }));
  const withoutShadow = assignRoles(players, 1, false, () => 0);
  const withShadow = assignRoles(players, 1, true, () => 0);
  assert.equal(withoutShadow.roles[withoutShadow.wordSetterId], "innocent");
  assert.equal(withShadow.roles[withShadow.wordSetterId], "innocent");
  assert.equal(Object.values(withShadow.roles).filter(role => role === "shadow").length, 1);
  assert.throws(() => assignRoles(players, 2, true), /must not start with Impostor parity/);
});


test("balanced Impostor limits prevent a match from starting at parity", () => {
  assert.equal(maxBalancedImpostors(3, false), 1);
  assert.equal(maxBalancedImpostors(3, true), 1);
  assert.equal(maxBalancedImpostors(4, false), 1);
  assert.equal(maxBalancedImpostors(5, false), 2);
  assert.equal(maxBalancedImpostors(8, false), 3);
  assert.equal(maxBalancedImpostors(15, true), 4);
  assert.equal(maxBalancedImpostors(2, false), 0);
});
