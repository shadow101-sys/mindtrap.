"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnPosition, clampWorldPosition, WORLD_LIMIT, MAX_WALK_SPEED, MAX_SPRINT_SPEED } = require("../lib/world-logic");

test("spawn positions are deterministic and stay inside the walkable area", () => {
  const first = spawnPosition(0, 8);
  assert.deepEqual(first, spawnPosition(0, 8));
  for (let index = 0; index < 15; index++) {
    const position = spawnPosition(index, 15);
    assert.ok(Math.abs(position.x) <= WORLD_LIMIT);
    assert.ok(Math.abs(position.z) <= WORLD_LIMIT);
    assert.ok(Number.isFinite(position.yaw));
  }
});

test("movement accepts normal walking and normalizes the view angle", () => {
  const position = clampWorldPosition({ x: 0, z: 10, yaw: 0 }, { x: 0.8, z: 10, yaw: Math.PI * 3 }, 0.2);
  assert.ok(position.x > 0);
  assert.equal(position.z, 10);
  assert.ok(Math.abs(position.yaw - Math.PI) < 0.001);
});

test("walking and sprinting are clamped to their server-side speed limits", () => {
  const start = { x: 0, z: 0, yaw: 0 };
  const walking = clampWorldPosition(start, { x: 10, z: 0, yaw: 0 }, 0.1);
  const sprinting = clampWorldPosition(start, { x: 10, z: 0, yaw: 0, sprinting: true }, 0.1);
  assert.ok(Math.abs(walking.x - MAX_WALK_SPEED * 0.1) < 0.001);
  assert.ok(Math.abs(sprinting.x - MAX_SPRINT_SPEED * 0.1) < 0.001);
});

test("movement is server clamped to prevent teleporting", () => {
  const position = clampWorldPosition({ x: 0, z: 0, yaw: 0 }, { x: 500, z: 500, yaw: 8 }, 0.05);
  assert.ok(Math.hypot(position.x, position.z) < 2);
  assert.ok(Math.abs(position.x) <= WORLD_LIMIT);
  assert.ok(Math.abs(position.z) <= WORLD_LIMIT);
});

test("invalid movement payloads are rejected", () => {
  assert.equal(clampWorldPosition({ x: 0, z: 0, yaw: 0 }, { x: "NaN", z: 0, yaw: 0 }), null);
});
