let THREE = null;
try {
  THREE = await import("https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js");
} catch (error) {
  console.warn("Three.js could not be loaded. The lightweight Cuby fallback will be used.", error);
}

const COLORS = {
  victory: ["#66e0d0", "#9a8cff"],
  defeat: ["#8390a7", "#e28a9a"]
};

function makeFallback(canvas, mood, side) {
  const context = canvas.getContext("2d");
  let frame = 0;
  let animationId = 0;
  let width = 1;
  let height = 1;
  const colors = COLORS[mood] || COLORS.victory;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    const ratio = Math.min(window.devicePixelRatio || 1, 1.7);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function polygon(points, fill, stroke = "rgba(255,255,255,.35)") {
    context.beginPath();
    points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
    context.closePath();
    context.fillStyle = fill;
    context.fill();
    context.strokeStyle = stroke;
    context.lineWidth = 1.2;
    context.stroke();
  }

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  function draw() {
    if (!reducedMotion) frame += 1;
    context.clearRect(0, 0, width, height);
    const wave = Math.sin(frame * .045 + (side === "right" ? 1 : 0));
    const centerX = width / 2;
    const centerY = height * .53 + (mood === "victory" ? wave * 8 : Math.abs(wave) * 3);
    const size = Math.min(width * .48, height * .46, 112);
    const tilt = mood === "victory" ? wave * .08 : .1;
    context.save();
    context.translate(centerX, centerY);
    context.rotate(tilt);
    polygon([[-size * .48, -size * .42], [0, -size * .69], [size * .48, -size * .42], [0, -size * .15]], colors[1]);
    polygon([[-size * .48, -size * .42], [0, -size * .15], [0, size * .53], [-size * .48, size * .25]], colors[0]);
    polygon([[0, -size * .15], [size * .48, -size * .42], [size * .48, size * .25], [0, size * .53]], mood === "victory" ? "#586da4" : "#566176");
    context.fillStyle = "#172039";
    context.beginPath();
    context.ellipse(-size * .16, -size * .02, size * .045, size * .07, 0, 0, Math.PI * 2);
    context.ellipse(size * .16, -size * .02, size * .045, size * .07, 0, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#172039";
    context.lineWidth = 3;
    context.beginPath();
    if (mood === "victory") context.arc(0, size * .12, size * .11, .15, Math.PI - .15);
    else context.arc(0, size * .27, size * .09, Math.PI + .2, Math.PI * 2 - .2);
    context.stroke();
    context.restore();
    if (mood === "victory") {
      context.fillStyle = colors[0];
      for (let index = 0; index < 4; index++) {
        const angle = frame * .018 + index * Math.PI / 2;
        const x = centerX + Math.cos(angle) * (size * .8);
        const y = centerY - size * .45 + Math.sin(angle) * (size * .65);
        context.fillRect(x, y, 4, 4);
      }
    }
    if (!reducedMotion) animationId = requestAnimationFrame(draw);
  }
  resize();
  draw();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  return () => {
    cancelAnimationFrame(animationId);
    observer.disconnect();
    context.clearRect(0, 0, width, height);
  };
}

function createCuby(canvas, mood, side) {
  if (!THREE) return makeFallback(canvas, mood, side);

  const colors = COLORS[mood] || COLORS.victory;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, .1, 30);
  camera.position.set(0, .3, 5.9);
  scene.add(new THREE.HemisphereLight(0xe4e9ff, 0x26304b, 2.1));
  const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
  keyLight.position.set(-3, 4, 5);
  scene.add(keyLight);
  const rimLight = new THREE.PointLight(mood === "victory" ? 0x5fe1d2 : 0xff687f, 3.8, 9);
  rimLight.position.set(2, 1.5, -1.5);
  scene.add(rimLight);

  const cuby = new THREE.Group();
  scene.add(cuby);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colors[0]), roughness: .38, metalness: .12
  });
  const sideMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(mood === "victory" ? "#6a75ce" : "#747e92"), roughness: .46, metalness: .1
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.25, 1.15), bodyMaterial);
  body.position.y = .05;
  cuby.add(body);
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.35, 1.25, 1.15)),
    new THREE.LineBasicMaterial({ color: mood === "victory" ? 0xd4fff8 : 0xe4b8c0, transparent: true, opacity: .54 })
  );
  edge.position.copy(body.position);
  cuby.add(edge);

  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xf8fbff, roughness: .3 });
  const pupilMaterial = new THREE.MeshStandardMaterial({ color: 0x19223b, roughness: .24 });
  const eyeGeometry = new THREE.SphereGeometry(.085, 18, 14);
  const pupilGeometry = new THREE.SphereGeometry(.039, 14, 12);
  for (const x of [-.25, .25]) {
    const eye = new THREE.Mesh(eyeGeometry, eyeWhite);
    eye.position.set(x, .18, .59);
    eye.scale.set(1, 1.18, .55);
    cuby.add(eye);
    const pupil = new THREE.Mesh(pupilGeometry, pupilMaterial);
    pupil.position.set(x + (side === "right" ? .012 : -.012), .17, .637);
    cuby.add(pupil);
  }

  const mouthPoints = mood === "victory"
    ? [new THREE.Vector3(-.12, -.09, .602), new THREE.Vector3(0, -.18, .66), new THREE.Vector3(.12, -.09, .602)]
    : [new THREE.Vector3(-.1, -.19, .61), new THREE.Vector3(0, -.14, .66), new THREE.Vector3(.1, -.19, .61)];
  const mouthCurve = new THREE.QuadraticBezierCurve3(mouthPoints[0], mouthPoints[1], mouthPoints[2]);
  const mouth = new THREE.Mesh(
    new THREE.TubeGeometry(mouthCurve, 12, .018, 6, false),
    new THREE.MeshStandardMaterial({ color: 0x24304a, roughness: .4 })
  );
  cuby.add(mouth);

  const armGeometry = new THREE.CapsuleGeometry(.095, .34, 4, 8);
  const legGeometry = new THREE.CapsuleGeometry(.09, .22, 4, 8);
  const limbMaterial = sideMaterial;
  const arms = [];
  const legs = [];
  for (const direction of [-1, 1]) {
    const armPivot = new THREE.Group();
    armPivot.position.set(direction * .75, -.13, .01);
    const arm = new THREE.Mesh(armGeometry, limbMaterial);
    arm.position.set(direction * .12, -.08, 0);
    arm.rotation.z = direction * -.54;
    armPivot.add(arm);
    cuby.add(armPivot);
    arms.push({ pivot: armPivot, direction });

    const legPivot = new THREE.Group();
    legPivot.position.set(direction * .34, -.62, .03);
    const leg = new THREE.Mesh(legGeometry, limbMaterial);
    leg.position.y = -.17;
    legPivot.add(leg);
    cuby.add(legPivot);
    legs.push({ pivot: legPivot, direction });
  }

  if (mood === "defeat") {
    const tearMaterial = new THREE.MeshStandardMaterial({ color: 0x83c9e8, emissive: 0x1f5270, emissiveIntensity: .28 });
    for (const x of [-.31, .31]) {
      const tear = new THREE.Mesh(new THREE.SphereGeometry(.045, 12, 10), tearMaterial);
      tear.position.set(x, -.06, .64);
      cuby.add(tear);
    }
    cuby.rotation.z = side === "left" ? -.08 : .08;
    arms.forEach(({ pivot, direction }) => { pivot.rotation.z = direction * .5; });
  }

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(.95, 48),
    new THREE.MeshBasicMaterial({ color: mood === "victory" ? 0x5fe1d2 : 0xff687f, transparent: true, opacity: .09, depthWrite: false })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -.95;
  cuby.add(ground);

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  let timeline = null;
  if (window.gsap && !reducedMotion) {
    if (mood === "victory") {
      timeline = window.gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } });
      timeline.to(cuby.position, { y: .2, duration: .65 }, 0);
      timeline.to(cuby.rotation, { y: side === "left" ? -.22 : .22, z: side === "left" ? -.09 : .09, duration: .9 }, 0);
      arms.forEach(({ pivot, direction }) => timeline.to(pivot.rotation, { z: direction * (side === "left" ? -.95 : -.8), x: direction * .22, duration: .42 }, 0));
      legs.forEach(({ pivot, direction }) => timeline.to(pivot.rotation, { z: direction * .16, duration: .32 }, 0));
    } else {
      timeline = window.gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } });
      timeline.to(cuby.rotation, { z: side === "left" ? -.13 : .13, x: .08, duration: 1.2 }, 0);
      timeline.to(cuby.position, { y: -.12, duration: 1.2 }, 0);
      arms.forEach(({ pivot, direction }) => timeline.to(pivot.rotation, { z: direction * .68, duration: .8 }, 0));
    }
  }

  let frame = 0;
  let animationId = 0;
  let disposed = false;
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
  resize();
  function animate() {
    if (disposed) return;
    frame += 1;
    if (!window.gsap && !reducedMotion) {
      if (mood === "victory") {
        cuby.position.y = Math.sin(frame * .055 + (side === "right" ? 1 : 0)) * .18;
        cuby.rotation.y = Math.sin(frame * .025) * .16;
        arms.forEach(({ pivot, direction }) => { pivot.rotation.z = direction * (-.34 + Math.sin(frame * .07) * .45); });
      } else {
        cuby.position.y = -.08 + Math.sin(frame * .025) * .025;
      }
    }
    renderer.render(scene, camera);
    animationId = requestAnimationFrame(animate);
  }
  animate();

  return () => {
    disposed = true;
    cancelAnimationFrame(animationId);
    timeline?.kill();
    resizeObserver.disconnect();
    scene.traverse(object => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => material.dispose());
      }
    });
    renderer.dispose();
  };
}

window.MindtrapCuby = {
  available: !!THREE,
  active: [],
  show(mood) {
    this.dispose();
    const left = document.getElementById("cuby-left");
    const right = document.getElementById("cuby-right");
    if (!left || !right) return;
    const safeCreate = (canvas, side) => {
      try { return createCuby(canvas, mood, side); }
      catch (error) {
        console.warn("3D Cuby renderer failed. Using the canvas fallback.", error);
        // A canvas cannot switch context types once WebGL has claimed it. Replace it before fallback.
        const fallbackCanvas = canvas.cloneNode(false);
        canvas.replaceWith(fallbackCanvas);
        return makeFallback(fallbackCanvas, mood, side);
      }
    };
    this.active = [safeCreate(left, "left"), safeCreate(right, "right")];
  },
  dispose() {
    this.active.forEach(dispose => { try { dispose(); } catch (error) { console.warn("Cuby cleanup failed.", error); } });
    this.active = [];
  }
};

window.dispatchEvent(new Event("mindtrap:cuby-ready"));
