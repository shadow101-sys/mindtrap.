"use strict";

const WORLD_LIMIT = 24;
const MAX_WALK_SPEED = 8.5;
const MAX_SPRINT_SPEED = 12.8;

function spawnPosition(index, totalPlayers = 15) {
  const count = Math.max(3, Math.floor(Number(totalPlayers) || 15));
  const slot = Math.max(0, Math.floor(Number(index) || 0));
  const angle = (slot / count) * Math.PI * 2;
  const radius = 10.5;
  const x = Math.sin(angle) * radius;
  const z = Math.cos(angle) * radius;
  return { x: Number(x.toFixed(3)), z: Number(z.toFixed(3)), yaw: Math.atan2(x, z) };
}

function clampWorldPosition(current, payload, elapsedSeconds = 0.1) {
  const previous = current && Number.isFinite(current.x) && Number.isFinite(current.z)
    ? current : { x: 0, z: 10, yaw: 0 };
  const rawX = Number(payload?.x);
  const rawZ = Number(payload?.z);
  const rawYaw = Number(payload?.yaw);
  if (![rawX, rawZ, rawYaw].every(Number.isFinite)) return null;

  let x = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, rawX));
  let z = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, rawZ));
  const dx = x - previous.x;
  const dz = z - previous.z;
  const distance = Math.hypot(dx, dz);
  const elapsed = Math.max(0.01, Math.min(0.5, Number(elapsedSeconds) || 0.1));
  const maxSpeed = payload.sprinting === true ? MAX_SPRINT_SPEED : MAX_WALK_SPEED;
  const maxDistance = maxSpeed * elapsed;

  if (distance > maxDistance && distance > 0) {
    const scale = maxDistance / distance;
    x = previous.x + dx * scale;
    z = previous.z + dz * scale;
  }

  const yaw = Math.atan2(Math.sin(rawYaw), Math.cos(rawYaw));
  return {
    x: Number(Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, x)).toFixed(3)),
    z: Number(Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, z)).toFixed(3)),
    yaw: Number(yaw.toFixed(4))
  };
}

module.exports = { WORLD_LIMIT, MAX_WALK_SPEED, MAX_SPRINT_SPEED, spawnPosition, clampWorldPosition };
