let THREE = null;
try {
  THREE = await import("https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js");
} catch (error) {
  console.error("MINDTRAP 3D world could not load Three.js.", error);
}

(() => {
  const socket = window.MindtrapSocket;
  const $ = id => document.getElementById(id);
  const canvas = $("world-canvas");
  const enterButton = $("world-enter");
  const status = $("world-status");
  if (!canvas || !enterButton) return;

  if (!THREE || !window.WebGLRenderingContext) {
    if (status) status.textContent = "3D VIEW UNAVAILABLE — check WebGL and your connection.";
    enterButton.disabled = true;
    enterButton.textContent = "3D unavailable";
    return;
  }

  const {
    Scene, Color, Fog, PerspectiveCamera, WebGLRenderer,
    HemisphereLight, AmbientLight, DirectionalLight, PointLight, SpotLight,
    Group, Mesh, MeshStandardMaterial, MeshPhysicalMaterial, MeshBasicMaterial,
    BoxGeometry, PlaneGeometry, CylinderGeometry, SphereGeometry, CapsuleGeometry,
    TorusGeometry, RingGeometry, EdgesGeometry, LineSegments, LineBasicMaterial,
    CircleGeometry, BufferGeometry, Float32BufferAttribute, Points, PointsMaterial,
    Sprite, SpriteMaterial, CanvasTexture, Vector3, MathUtils
  } = THREE;

  const WORLD_LIMIT = 24;
  const WALK_SPEED = 7.6;
  const RUN_SPEED = 12.2;
  const keys = new Set();
  const remotePlayers = new Map();
  const movementVector = new Vector3();
  const forward = new Vector3();
  const right = new Vector3();
  const timer = new THREE.Timer();

  const scene = new Scene();
  scene.background = new Color(0x080d1b);
  scene.fog = new Fog(0x080d1b, 27, 78);

  const camera = new PerspectiveCamera(76, 1, 0.08, 150);
  camera.position.set(0, 1.68, 10);
  camera.rotation.order = "YXZ";

  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  } catch (error) {
    console.error("WebGL renderer initialization failed.", error);
    if (status) status.textContent = "Your browser could not start WebGL.";
    enterButton.disabled = true;
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setSize(canvas.clientWidth || 1000, canvas.clientHeight || 520, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  scene.add(new HemisphereLight(0xc5d7ff, 0x151b30, 1.7));
  scene.add(new AmbientLight(0x8498c9, 0.48));
  const key = new DirectionalLight(0xe1eaff, 2.1);
  key.position.set(-10, 22, 12);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -30;
  key.shadow.camera.right = 30;
  key.shadow.camera.top = 30;
  key.shadow.camera.bottom = -30;
  scene.add(key);

  const cyanLight = new PointLight(0x45dff1, 45, 32, 2);
  cyanLight.position.set(-8, 5, -7);
  scene.add(cyanLight);
  const violetLight = new PointLight(0x9276ff, 38, 30, 2);
  violetLight.position.set(9, 4, 7);
  scene.add(violetLight);

  const materials = {
    floor: new MeshStandardMaterial({ color: 0x151d31, roughness: 0.72, metalness: 0.48 }),
    floorAlt: new MeshStandardMaterial({ color: 0x1a2740, roughness: 0.64, metalness: 0.42 }),
    wall: new MeshStandardMaterial({ color: 0x202b43, roughness: 0.56, metalness: 0.56 }),
    dark: new MeshStandardMaterial({ color: 0x0b1223, roughness: 0.48, metalness: 0.65 }),
    trim: new MeshStandardMaterial({ color: 0x455477, roughness: 0.34, metalness: 0.75 }),
    cyan: new MeshStandardMaterial({ color: 0x44dcec, emissive: 0x087f99, emissiveIntensity: 1.6, roughness: 0.28, metalness: 0.42 }),
    violet: new MeshStandardMaterial({ color: 0xa18aff, emissive: 0x4e35ba, emissiveIntensity: 1.45, roughness: 0.3, metalness: 0.35 }),
    gold: new MeshStandardMaterial({ color: 0xffcb75, emissive: 0x8a4c13, emissiveIntensity: 1.0, roughness: 0.38, metalness: 0.32 }),
    glass: new MeshPhysicalMaterial({ color: 0x3b6888, emissive: 0x061b31, transparent: true, opacity: 0.22, roughness: 0.15, metalness: 0.2, transmission: 0.25 })
  };

  function addBox(parent, x, y, z, sx, sy, sz, material, options = {}) {
    const mesh = new Mesh(new BoxGeometry(sx, sy, sz), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = options.castShadow !== false;
    mesh.receiveShadow = true;
    if (options.rotationY) mesh.rotation.y = options.rotationY;
    parent.add(mesh);
    return mesh;
  }
  function addCylinder(parent, x, y, z, radiusTop, radiusBottom, height, material, segments = 32) {
    const mesh = new Mesh(new CylinderGeometry(radiusTop, radiusBottom, height, segments), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function addRing(parent, x, y, z, radius, tube, material) {
    const ring = new Mesh(new TorusGeometry(radius, tube, 10, 72), material);
    ring.position.set(x, y, z);
    ring.rotation.x = Math.PI / 2;
    parent.add(ring);
    return ring;
  }

  // A large walkable, open-plan station built entirely from procedural geometry.
  addBox(scene, 0, -0.22, 0, 52, 0.42, 52, materials.floor);
  const grid = new THREE.GridHelper(52, 52, 0x29415e, 0x1b2a43);
  grid.position.y = 0.012;
  grid.material.transparent = true;
  grid.material.opacity = 0.38;
  scene.add(grid);

  // Repeating floor plates and inset light strips.
  for (let x = -22; x <= 22; x += 4) {
    for (let z = -22; z <= 22; z += 4) {
      if ((Math.abs(x) < 4 && Math.abs(z) < 4) || ((x + z) % 8 === 0)) continue;
      const plate = addBox(scene, x, 0.015, z, 3.82, 0.055, 3.82,
        ((x / 4 + z / 4) % 2 === 0) ? materials.floorAlt : materials.dark, { castShadow: false });
      plate.receiveShadow = true;
    }
  }
  for (let n = -2; n <= 2; n++) {
    addBox(scene, n * 8, 0.045, -25.35, 0.06, 0.035, 49, materials.cyan, { castShadow: false });
    addBox(scene, n * 8, 0.045, 25.35, 0.06, 0.035, 49, materials.violet, { castShadow: false });
    addBox(scene, -25.35, 0.045, n * 8, 49, 0.035, 0.06, materials.violet, { castShadow: false });
    addBox(scene, 25.35, 0.045, n * 8, 49, 0.035, 0.06, materials.cyan, { castShadow: false });
  }

  // Outer walls with large glowing windows.
  for (const side of [-1, 1]) {
    const z = side * 25.5;
    addBox(scene, -17, 2.6, z, 17, 5.2, 0.9, materials.wall);
    addBox(scene, 17, 2.6, z, 17, 5.2, 0.9, materials.wall);
    addBox(scene, 0, 0.25, z, 16, 0.5, 0.9, materials.dark);
    addBox(scene, 0, 5.0, z, 16, 0.35, 0.9, materials.trim);
    for (let x = -8; x <= 8; x += 4) {
      addBox(scene, x, 2.65, z + side * 0.24, 0.1, 4.25, 0.11, materials.cyan, { castShadow: false });
      addBox(scene, x + 1.8, 2.5, z - side * 0.16, 3.5, 3.9, 0.12, materials.glass, { castShadow: false });
    }
    addBox(scene, 0, 5.35, z, 52, 0.38, 1.0, materials.dark);
    addBox(scene, 0, 4.95, z - side * 0.52, 50, 0.07, 0.08, side > 0 ? materials.cyan : materials.violet, { castShadow: false });
  }
  for (const side of [-1, 1]) {
    const x = side * 25.5;
    addBox(scene, x, 2.6, -17, 0.9, 5.2, 17, materials.wall);
    addBox(scene, x, 2.6, 17, 0.9, 5.2, 17, materials.wall);
    addBox(scene, x, 5.0, 0, 0.9, 0.35, 16, materials.trim);
    for (let z = -8; z <= 8; z += 4) {
      addBox(scene, x - side * 0.24, 2.65, z, 0.11, 4.25, 0.1, materials.violet, { castShadow: false });
      addBox(scene, x + side * 0.16, 2.5, z + 1.8, 0.12, 3.9, 3.5, materials.glass, { castShadow: false });
    }
    addBox(scene, x, 4.95, 0, 0.08, 0.07, 50, side > 0 ? materials.cyan : materials.violet, { castShadow: false });
  }

  // Ceiling beams create depth while leaving most of the sky visible.
  for (let n = -2; n <= 2; n++) {
    addBox(scene, n * 10, 6.0, 0, 0.38, 0.28, 50, materials.dark);
    addBox(scene, 0, 6.0, n * 10, 50, 0.28, 0.38, materials.dark);
    const lamp = new SpotLight(n % 2 ? 0x7b78ff : 0x42d9ef, 16, 31, Math.PI / 4.2, 0.55, 1.5);
    lamp.position.set(n * 9, 5.6, n * -5);
    lamp.target.position.set(n * 3, 0, n * 3);
    scene.add(lamp, lamp.target);
  }

  // Corner supports and luminous bands.
  for (const x of [-23.5, 23.5]) {
    for (const z of [-23.5, 23.5]) {
      addBox(scene, x, 2.5, z, 1.1, 5.2, 1.1, materials.dark);
      addBox(scene, x, 2.9, z, 1.18, 0.12, 1.18, materials.cyan, { castShadow: false });
      addBox(scene, x, 1.0, z, 1.2, 0.1, 1.2, materials.violet, { castShadow: false });
    }
  }

  // The central meeting dais.
  addCylinder(scene, 0, 0.15, 0, 5.6, 5.9, 0.26, materials.dark, 72);
  addCylinder(scene, 0, 0.34, 0, 4.7, 5.0, 0.16, materials.trim, 72);
  addCylinder(scene, 0, 0.46, 0, 3.9, 4.2, 0.12, materials.floorAlt, 72);
  addRing(scene, 0, 0.53, 0, 4.2, 0.055, materials.cyan);
  addRing(scene, 0, 0.54, 0, 5.15, 0.035, materials.violet);
  addCylinder(scene, 0, 0.75, 0, 1.3, 1.5, 0.55, materials.dark, 48);
  addCylinder(scene, 0, 1.05, 0, 1.15, 1.3, 0.08, materials.cyan, 48);
  const holoCore = new Mesh(new SphereGeometry(0.36, 24, 18), new MeshStandardMaterial({
    color: 0x88f6ff, emissive: 0x28c9e7, emissiveIntensity: 2.1, transparent: true, opacity: 0.88
  }));
  holoCore.position.set(0, 1.62, 0);
  scene.add(holoCore);
  const halo1 = addRing(scene, 0, 1.55, 0, 0.8, 0.025, materials.violet);
  halo1.rotation.set(Math.PI / 2.8, 0.4, 0);
  const halo2 = addRing(scene, 0, 1.55, 0, 1.05, 0.018, materials.cyan);
  halo2.rotation.set(Math.PI / 2.3, -0.5, 0);

  // Console islands on the four diagonal quadrants.
  function makeConsole(x, z, accent) {
    const group = new Group();
    group.position.set(x, 0, z);
    scene.add(group);
    addBox(group, 0, 0.7, 0, 2.4, 1.35, 1.25, materials.dark);
    addBox(group, 0, 1.38, -0.08, 2.25, 0.08, 1.08, materials.trim);
    addBox(group, 0, 1.47, -0.08, 1.85, 0.018, 0.77, accent, { castShadow: false });
    addBox(group, 0, 1.52, 0.43, 0.13, 0.035, 0.1, materials.gold, { castShadow: false });
    for (const sx of [-0.95, 0.95]) {
      addBox(group, sx, 0.38, 0, 0.16, 0.74, 0.95, materials.trim);
    }
    const vertical = new PointLight(accent.color || 0x44dcec, 4, 6, 2);
    vertical.position.set(0, 2.2, 0);
    group.add(vertical);
    return group;
  }
  const consoles = [
    makeConsole(-10, -10, materials.cyan),
    makeConsole(10, -10, materials.violet),
    makeConsole(-10, 10, materials.violet),
    makeConsole(10, 10, materials.cyan)
  ];

  // Small wall control panels and floor pylons.
  for (const side of [-1, 1]) {
    for (let n = -2; n <= 2; n++) {
      const x = side * 22.9;
      const z = n * 8;
      addBox(scene, x, 1.7, z, 0.22, 1.5, 2.5, materials.dark);
      addBox(scene, x - side * 0.14, 1.8, z, 0.08, 0.85, 1.75, n % 2 ? materials.violet : materials.cyan, { castShadow: false });
    }
  }
  for (const x of [-17, 17]) {
    for (const z of [-17, 17]) {
      addCylinder(scene, x, 0.62, z, 0.55, 0.72, 1.2, materials.dark, 16);
      addRing(scene, x, 1.24, z, 0.48, 0.035, materials.cyan);
      addBox(scene, x, 1.68, z, 0.16, 0.65, 0.16, materials.violet, { castShadow: false });
    }
  }

  // Floating dust particles give the station a subtle sense of scale.
  const particlePositions = [];
  for (let i = 0; i < 500; i++) {
    particlePositions.push((Math.random() - 0.5) * 47, Math.random() * 5.3 + 0.2, (Math.random() - 0.5) * 47);
  }
  const particleGeometry = new BufferGeometry();
  particleGeometry.setAttribute("position", new Float32BufferAttribute(particlePositions, 3));
  const particles = new Points(particleGeometry, new PointsMaterial({ color: 0x8ab8dd, size: 0.035, transparent: true, opacity: 0.48, sizeAttenuation: true }));
  scene.add(particles);

  function makeLabel(name, color) {
    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 512;
    labelCanvas.height = 128;
    const ctx = labelCanvas.getContext("2d");
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = "rgba(7, 12, 27, .84)";
    ctx.beginPath();
    ctx.roundRect(20, 16, 472, 96, 24);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = "#f1f5ff";
    ctx.font = "700 36px Inter, Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(name || "PLAYER").toUpperCase().slice(0, 18), 256, 65);
    const texture = new CanvasTexture(labelCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false, sizeAttenuation: true }));
    sprite.scale.set(2.25, 0.56, 1);
    return sprite;
  }

  function stableColor(id) {
    const colors = [0x8e82ff, 0x45dbe8, 0xff987a, 0x72d7a8, 0xffcc75, 0xe58bc9, 0x77aaff, 0xd2e0f0];
    let hash = 0;
    for (const char of String(id || "")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return colors[hash % colors.length];
  }

  function createPlayerAvatar(player) {
    const group = new Group();
    const color = stableColor(player.id);
    const bodyMat = new MeshStandardMaterial({ color, roughness: 0.43, metalness: 0.35, emissive: color, emissiveIntensity: 0.1 });
    const darkMat = new MeshStandardMaterial({ color: 0x18243b, roughness: 0.35, metalness: 0.5 });
    const visorMat = new MeshPhysicalMaterial({ color: 0xb8f8ff, emissive: 0x226b8b, emissiveIntensity: 0.7, roughness: 0.17, metalness: 0.3, clearcoat: 0.8 });
    const body = new Mesh(new CapsuleGeometry(0.38, 0.72, 5, 12), bodyMat);
    body.position.y = 1.0;
    body.castShadow = true;
    group.add(body);
    const head = new Mesh(new SphereGeometry(0.35, 24, 18), bodyMat);
    head.position.y = 1.82;
    head.castShadow = true;
    group.add(head);
    const visor = new Mesh(new BoxGeometry(0.47, 0.19, 0.1), visorMat);
    visor.position.set(0, 1.86, -0.305);
    group.add(visor);
    const backpack = new Mesh(new BoxGeometry(0.4, 0.55, 0.26), darkMat);
    backpack.position.set(0, 1.05, 0.38);
    group.add(backpack);
    for (const side of [-1, 1]) {
      const arm = new Mesh(new CapsuleGeometry(0.095, 0.48, 4, 8), bodyMat);
      arm.position.set(side * 0.47, 1.05, 0.02);
      arm.rotation.z = -side * 0.17;
      group.add(arm);
      const leg = new Mesh(new CapsuleGeometry(0.12, 0.35, 4, 8), darkMat);
      leg.position.set(side * 0.19, 0.36, 0);
      group.add(leg);
    }
    const feetRing = new Mesh(new TorusGeometry(0.48, 0.035, 8, 48), new MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }));
    feetRing.rotation.x = Math.PI / 2;
    feetRing.position.y = 0.08;
    group.add(feetRing);

    const label = makeLabel(player.name, `#${color.toString(16).padStart(6, "0")}`);
    label.position.y = 2.55;
    group.add(label);

    const voiceGlow = new Mesh(new TorusGeometry(0.62, 0.055, 8, 48), new MeshBasicMaterial({ color: 0x5fe1d2, transparent: true, opacity: 0 }));
    voiceGlow.rotation.x = Math.PI / 2;
    voiceGlow.position.y = 0.12;
    group.add(voiceGlow);

    return { group, label, bodyMat, feetRing, voiceGlow, target: new Vector3(), targetYaw: 0, phase: Math.random() * 6.28, connected: true };
  }

  function syncPlayer(player) {
    if (!player || player.socketId === socket?.id) return;
    let avatar = remotePlayers.get(player.id);
    if (!avatar) {
      avatar = createPlayerAvatar(player);
      scene.add(avatar.group);
      remotePlayers.set(player.id, avatar);
    }
    const p = player.position || {};
    if (Number.isFinite(p.x) && Number.isFinite(p.z)) avatar.target.set(p.x, 0, p.z);
    avatar.targetYaw = Number.isFinite(p.yaw) ? p.yaw : 0;
    avatar.connected = player.connected !== false;
    avatar.voiceGlow.material.opacity = player.voiceEnabled ? 0.8 : 0;
    avatar.group.visible = true;
    avatar.bodyMat.transparent = !avatar.connected;
    avatar.bodyMat.opacity = avatar.connected ? 1 : 0.42;
    avatar.label.material.opacity = avatar.connected ? 1 : 0.45;
  }

  function syncAllPlayers(players) {
    const valid = new Set();
    for (const player of players || []) {
      if (player.id && player.id !== localPlayerId) {
        valid.add(player.id);
        syncPlayer(player);
      }
    }
    for (const [id, avatar] of remotePlayers) {
      if (!valid.has(id)) {
        scene.remove(avatar.group);
        avatar.group.traverse(object => {
          if (object.geometry) object.geometry.dispose();
          if (object.material) {
            const list = Array.isArray(object.material) ? object.material : [object.material];
            list.forEach(material => material.dispose());
          }
        });
        remotePlayers.delete(id);
      }
    }
  }

  let currentRoomCode = null;
  let localPlayerId = null;
  let hasSpawned = false;
  let yaw = 0;
  let pitch = 0;
  let lastSentAt = 0;
  let lastSentYaw = null;
  let localPosition = new Vector3(0, 1.68, 10);
  let draggingTouch = false;
  let lastTouchX = 0;
  let lastTouchY = 0;
  let animationId = 0;
  let disposed = false;

  function setRoom(data) {
    if (!data || !data.code) {
      currentRoomCode = null;
      localPlayerId = null;
      hasSpawned = false;
      for (const [id, avatar] of remotePlayers) {
        scene.remove(avatar.group);
        remotePlayers.delete(id);
      }
      return;
    }
    if (currentRoomCode !== data.code) {
      currentRoomCode = data.code;
      hasSpawned = false;
      keys.clear();
    }
    const me = (data.players || []).find(player => player.socketId === socket?.id);
    localPlayerId = me?.id || localPlayerId;
    if (me?.position && !hasSpawned) {
      localPosition.set(me.position.x || 0, 1.68, me.position.z || 0);
      yaw = Number.isFinite(me.position.yaw) ? me.position.yaw : 0;
      hasSpawned = true;
      camera.position.copy(localPosition);
      camera.rotation.set(pitch, yaw, 0, "YXZ");
    } else if (me && !hasSpawned) {
      localPosition.set(0, 1.68, 10);
      yaw = 0;
      hasSpawned = true;
      camera.position.copy(localPosition);
    }
    syncAllPlayers(data.players || []);
    if (status) status.textContent = "CONNECTED TO CREW · SPATIAL MOVEMENT LIVE";
    const phase = $("room-phase")?.textContent?.trim() || "LOBBY";
    const label = $("world-phase");
    if (label) label.textContent = phase;
    const count = $("world-player-count");
    if (count) count.textContent = `${(data.players || []).filter(player => player.connected).length} / ${data.settings?.maxPlayers || 15} CREW`;
  }

  function requestPlay() {
    if (!currentRoomCode) return;
    if (document.pointerLockElement === canvas) {
      document.exitPointerLock?.();
      return;
    }
    try {
      const result = canvas.requestPointerLock?.();
      result?.catch?.(() => { if (status) status.textContent = "Click the world view to enable mouse look."; });
    } catch (error) {
      console.warn("Pointer lock is not available.", error);
      if (status) status.textContent = "Mouse look is unavailable in this browser.";
    }
  }
  enterButton.addEventListener("click", requestPlay);
  canvas.addEventListener("click", () => {
    if (currentRoomCode && document.pointerLockElement !== canvas && !("ontouchstart" in window)) requestPlay();
  });
  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === canvas;
    enterButton.textContent = locked ? "ESC TO RELEASE MOUSE" : "ENTER FIRST PERSON";
    enterButton.classList.toggle("is-playing", locked);
    if (status) status.textContent = locked
      ? "FIRST PERSON ACTIVE · WASD MOVE · SHIFT SPRINT · ESC RELEASE"
      : currentRoomCode ? "CLICK ENTER FIRST PERSON TO WALK AROUND" : "WAITING FOR A ROOM";
    keys.clear();
  });
  document.addEventListener("mousemove", event => {
    if (document.pointerLockElement !== canvas) return;
    yaw -= event.movementX * 0.0021;
    pitch = MathUtils.clamp(pitch - event.movementY * 0.0018, -1.35, 1.35);
    camera.rotation.set(pitch, yaw, 0, "YXZ");
  });

  function isTypingTarget(target) {
    return !!target?.closest?.("input, textarea, select, button, [contenteditable='true']");
  }
  document.addEventListener("keydown", event => {
    if (isTypingTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(key)) {
      if (document.pointerLockElement === canvas) event.preventDefault();
      keys.add(key);
    }
  });
  document.addEventListener("keyup", event => keys.delete(event.key.toLowerCase()));
  window.addEventListener("blur", () => keys.clear());

  // Touch users can drag to look and hold the movement pad to walk.
  canvas.addEventListener("pointerdown", event => {
    if (event.pointerType !== "touch" || !currentRoomCode) return;
    draggingTouch = true;
    lastTouchX = event.clientX;
    lastTouchY = event.clientY;
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener("pointermove", event => {
    if (!draggingTouch || event.pointerType !== "touch") return;
    const dx = event.clientX - lastTouchX;
    const dy = event.clientY - lastTouchY;
    lastTouchX = event.clientX;
    lastTouchY = event.clientY;
    yaw -= dx * 0.006;
    pitch = MathUtils.clamp(pitch - dy * 0.005, -1.25, 1.25);
    camera.rotation.set(pitch, yaw, 0, "YXZ");
  });
  const touchPad = $("world-touch-pad");
  if (touchPad) {
    touchPad.querySelectorAll("[data-move]").forEach(button => {
      const press = event => {
        event.preventDefault();
        keys.add(button.dataset.move);
        button.classList.add("is-pressed");
      };
      const release = event => {
        event.preventDefault();
        keys.delete(button.dataset.move);
        button.classList.remove("is-pressed");
      };
      button.addEventListener("pointerdown", press);
      ["pointerup", "pointercancel", "pointerleave"].forEach(name => button.addEventListener(name, release));
    });
  }
  canvas.addEventListener("pointerup", event => { if (event.pointerType === "touch") draggingTouch = false; });
  canvas.addEventListener("pointercancel", () => { draggingTouch = false; keys.clear(); });

  function sendPosition(now) {
    if (!socket?.connected || !currentRoomCode || now - lastSentAt < 90) return;
    lastSentAt = now;
    socket.emit("world:move", { x: localPosition.x, z: localPosition.z, yaw, sprinting: keys.has("shift") });
    lastSentYaw = yaw;
  }

  if (socket) {
    socket.on("world:player-moved", data => {
      if (!data?.playerId || data.playerId === localPlayerId) {
        if (data?.playerId === localPlayerId && data.position && Number.isFinite(data.position.x) && Number.isFinite(data.position.z)) {
          // Server-side movement clamping is authoritative; gently correct any drift.
          if (Math.hypot(data.position.x - localPosition.x, data.position.z - localPosition.z) > 1.5) {
            localPosition.x = data.position.x;
            localPosition.z = data.position.z;
            camera.position.x = localPosition.x;
            camera.position.z = localPosition.z;
          }
        }
        return;
      }
      const player = { id: data.playerId, name: data.name, position: data.position, connected: true, voiceEnabled: data.voiceEnabled };
      syncPlayer(player);
    });
  }

  function update(dt, now) {
    if (document.pointerLockElement === canvas || draggingTouch || keys.size > 0) {
      const activeForward = keys.has("w") || keys.has("arrowup") ? 1 : 0;
      const activeBack = keys.has("s") || keys.has("arrowdown") ? 1 : 0;
      const activeRight = keys.has("d") || keys.has("arrowright") ? 1 : 0;
      const activeLeft = keys.has("a") || keys.has("arrowleft") ? 1 : 0;
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      right.crossVectors(forward, new Vector3(0, 1, 0)).normalize();
      movementVector.set(0, 0, 0);
      movementVector.addScaledVector(forward, activeForward - activeBack);
      movementVector.addScaledVector(right, activeRight - activeLeft);
      if (movementVector.lengthSq() > 0) {
        movementVector.normalize();
        const speed = keys.has("shift") ? RUN_SPEED : WALK_SPEED;
        localPosition.addScaledVector(movementVector, speed * dt);
        localPosition.x = MathUtils.clamp(localPosition.x, -WORLD_LIMIT, WORLD_LIMIT);
        localPosition.z = MathUtils.clamp(localPosition.z, -WORLD_LIMIT, WORLD_LIMIT);
        camera.position.x = localPosition.x;
        camera.position.z = localPosition.z;
      }
      const yawChanged = lastSentYaw === null
        || Math.abs(Math.atan2(Math.sin(yaw - lastSentYaw), Math.cos(yaw - lastSentYaw))) > 0.025;
      if (movementVector.lengthSq() > 0 || yawChanged) sendPosition(now);
      camera.position.y = 1.68 + (movementVector.lengthSq() > 0 ? Math.sin(now * 0.012) * 0.025 : 0);
    }

    for (const avatar of remotePlayers.values()) {
      avatar.group.position.lerp(avatar.target, 1 - Math.exp(-dt * 10));
      const angleDelta = Math.atan2(Math.sin(avatar.targetYaw - avatar.group.rotation.y), Math.cos(avatar.targetYaw - avatar.group.rotation.y));
      avatar.group.rotation.y += angleDelta * (1 - Math.exp(-dt * 8));
      avatar.phase += dt * 2.1;
      avatar.group.position.y = Math.sin(avatar.phase) * 0.035;
    }
    holoCore.rotation.y += dt * 0.5;
    halo1.rotation.y += dt * 0.3;
    halo2.rotation.z -= dt * 0.23;
    particles.rotation.y += dt * 0.006;
    consoles.forEach((consoleGroup, index) => {
      consoleGroup.children[2].material.emissiveIntensity = 0.9 + Math.sin(now * 0.0015 + index) * 0.28;
    });
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  window.addEventListener("resize", resize);

  function animate(now = 0) {
    if (disposed) return;
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    update(dt, now);
    renderer.render(scene, camera);
    animationId = requestAnimationFrame(animate);
  }
  animate();

  window.MindtrapWorld = {
    setRoom,
    dispose() {
      disposed = true;
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
      scene.traverse(object => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          const list = Array.isArray(object.material) ? object.material : [object.material];
          list.forEach(material => {
            if (material.map) material.map.dispose();
            material.dispose();
          });
        }
      });
      renderer.dispose();
    }
  };
  window.dispatchEvent(new Event("mindtrap:world-ready"));
})();
