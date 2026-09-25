const MOUSE_SENSITIVITY_DEFAULT = 0.00065;
let mouseSensitivity = MOUSE_SENSITIVITY_DEFAULT;

const STAND_HEIGHT = 1.7;
const CROUCH_HEIGHT = 0.9;
const RUN_SPEED = 12.0;
const WALK_SPEED = 5.5;
const CROUCH_SPEED = 4.5;
const JUMP_FORCE = 8.5;
const GRAVITY = 26.0;
const PLAYER_RADIUS = 0.6;

let enableAudio = true;
let forceTouchControls = false;

const keys = {};
const player = {
  position: new THREE.Vector3(0, STAND_HEIGHT, 0),
  velocity: new THREE.Vector3(),
  rotation: new THREE.Euler(0, 0, 0, 'YXZ'),
  onGround: true,
  isCrouching: false,
  isWalking: false,
  eyeHeight: STAND_HEIGHT
};

const colliders = [];

const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xd0e0f0, 0.008);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({
  antialias: true
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

let audioCtx = null;
let lastStepTime = 0;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new(window.AudioContext || window.webkitAudioContext)();
  }
}

function playFootstepSound() {
  if (!enableAudio || !audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(120, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 0.08);

  filter.type = 'lowpass';
  filter.frequency.value = 300;

  gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start();
  osc.stop(audioCtx.currentTime + 0.08);
}

function buildEnvironment() {
  // Sky Dome
  const skyGeo = new THREE.SphereGeometry(500, 32, 15);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: {
        value: new THREE.Color(0x0f2b5c)
      },
      bottomColor: {
        value: new THREE.Color(0x99ccff)
      },
      offset: {
        value: 20
      },
      exponent: {
        value: 0.6
      }
    },
    vertexShader: `
          varying vec3 vWorldPosition;
          void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
    fragmentShader: `
          uniform vec3 topColor;
          uniform vec3 bottomColor;
          uniform float offset;
          uniform float exponent;
          varying vec3 vWorldPosition;
          void main() {
            float h = normalize(vWorldPosition + offset).y;
            gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
          }
        `,
    side: THREE.BackSide
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // Light & Sun
  const light = new THREE.DirectionalLight(0xfff5ea, 1.3);
  light.position.set(60, 100, 40);
  light.castShadow = true;
  light.shadow.mapSize.width = 2048;
  light.shadow.mapSize.height = 2048;
  light.shadow.camera.near = 0.5;
  light.shadow.camera.far = 300;
  const d = 100;
  light.shadow.camera.left = -d;
  light.shadow.camera.right = d;
  light.shadow.camera.top = d;
  light.shadow.camera.bottom = -d;
  light.shadow.bias = -0.0005;
  scene.add(light);

  const ambientLight = new THREE.AmbientLight(0x8899b0, 0.5);
  scene.add(ambientLight);

  const sunGeo = new THREE.SphereGeometry(6, 32, 32);
  const sunMat = new THREE.MeshBasicMaterial({
    color: 0xffffff
  });
  const sunMesh = new THREE.Mesh(sunGeo, sunMat);
  sunMesh.position.copy(light.position);
  scene.add(sunMesh);

  // Simple Ground Plane
  const groundGeo = new THREE.PlaneGeometry(300, 300);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x333842,
    roughness: 0.8
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Simple Grid Helper overlaid
  const grid = new THREE.GridHelper(300, 60, 0x555555, 0x444444);
  grid.position.y = 0.01;
  scene.add(grid);

  // A few simple aesthetic pillars/boxes for reference
  function addPillar(x, z, h = 6) {
    const geo = new THREE.BoxGeometry(4, h, 4);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x667085,
      roughness: 0.7
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
  }

  addPillar(-20, -20, 8);
  addPillar(25, -30, 5);
  addPillar(-15, 25, 6);
  addPillar(30, 20, 10);
}

buildEnvironment();

document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start-btn');

function startGameSession(e) {
  if (e) e.stopPropagation();
  initAudio();
  overlay.classList.add('hidden');
  if (!isMobileDevice() && !forceTouchControls) {
    document.body.requestPointerLock();
  }
}

startBtn.addEventListener('click', startGameSession);
startBtn.addEventListener('touchstart', startGameSession);

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === document.body) {
    overlay.classList.add('hidden');
  } else if (document.getElementById('settings-modal').classList.contains('hidden') && !isMobileDevice() && !forceTouchControls) {
    overlay.classList.remove('hidden');
  }
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === document.body) {
    player.rotation.y -= e.movementX * mouseSensitivity;
    player.rotation.x -= e.movementY * mouseSensitivity;
    player.rotation.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, player.rotation.x));
  }
});

const joystickCanvas = document.getElementById('joystick-canvas');
const joystickCtx = joystickCanvas.getContext('2d');
const trackpadArea = document.getElementById('trackpad-area');

let joystickActive = false;
let joystickTouchId = null;
let joystickOrigin = {
  x: 0,
  y: 0
};
let joystickCurrent = {
  x: 0,
  y: 0
};
let touchMoveVector = {
  x: 0,
  y: 0
};

let trackpadTouchId = null;
let trackpadLastPos = {
  x: 0,
  y: 0
};

function resizeTouchCanvas() {
  joystickCanvas.width = joystickCanvas.clientWidth;
  joystickCanvas.height = joystickCanvas.clientHeight;
}
window.addEventListener('resize', resizeTouchCanvas);
resizeTouchCanvas();

joystickCanvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (joystickActive) return;
  const touch = e.changedTouches[0];
  joystickActive = true;
  joystickTouchId = touch.identifier;
  const rect = joystickCanvas.getBoundingClientRect();
  joystickOrigin = {
    x: touch.clientX - rect.left,
    y: touch.clientY - rect.top
  };
  joystickCurrent = {
    ...joystickOrigin
  };
});

joystickCanvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (let touch of e.changedTouches) {
    if (touch.identifier === joystickTouchId) {
      const rect = joystickCanvas.getBoundingClientRect();
      joystickCurrent = {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top
      };

      let dx = joystickCurrent.x - joystickOrigin.x;
      let dy = joystickCurrent.y - joystickOrigin.y;
      let dist = Math.hypot(dx, dy);
      let maxR = 50;
      if (dist > maxR) {
        dx = (dx / dist) * maxR;
        dy = (dy / dist) * maxR;
      }
      touchMoveVector.x = dx / maxR;
      touchMoveVector.y = dy / maxR;
    }
  }
});

function resetJoystick() {
  joystickActive = false;
  joystickTouchId = null;
  touchMoveVector = {
    x: 0,
    y: 0
  };
  drawJoystick();
}

joystickCanvas.addEventListener('touchend', resetJoystick);
joystickCanvas.addEventListener('touchcancel', resetJoystick);

function drawJoystick() {
  joystickCtx.clearRect(0, 0, joystickCanvas.width, joystickCanvas.height);
  if (!joystickActive) return;

  joystickCtx.beginPath();
  joystickCtx.arc(joystickOrigin.x, joystickOrigin.y, 50, 0, Math.PI * 2);
  joystickCtx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  joystickCtx.fill();
  joystickCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  joystickCtx.lineWidth = 2;
  joystickCtx.stroke();

  joystickCtx.beginPath();
  joystickCtx.arc(
    joystickOrigin.x + touchMoveVector.x * 50,
    joystickOrigin.y + touchMoveVector.y * 50,
    25, 0, Math.PI * 2
  );
  joystickCtx.fillStyle = 'rgba(52, 211, 153, 0.6)';
  joystickCtx.fill();
}

trackpadArea.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (trackpadTouchId !== null) return;
  const touch = e.changedTouches[0];
  trackpadTouchId = touch.identifier;
  trackpadLastPos = {
    x: touch.clientX,
    y: touch.clientY
  };
});

trackpadArea.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (let touch of e.changedTouches) {
    if (touch.identifier === trackpadTouchId) {
      let dx = touch.clientX - trackpadLastPos.x;
      let dy = touch.clientY - trackpadLastPos.y;

      player.rotation.y -= dx * (mouseSensitivity * 2.5);
      player.rotation.x -= dy * (mouseSensitivity * 2.5);
      player.rotation.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, player.rotation.x));

      trackpadLastPos = {
        x: touch.clientX,
        y: touch.clientY
      };
    }
  }
});

function resetTrackpad() {
  trackpadTouchId = null;
}
trackpadArea.addEventListener('touchend', resetTrackpad);
trackpadArea.addEventListener('touchcancel', resetTrackpad);

const btnJump = document.getElementById('btn-jump');
const btnCrouch = document.getElementById('btn-crouch');
const btnWalk = document.getElementById('btn-walk');

function bindTouchAction(elem, keyName) {
  elem.addEventListener('touchstart', (e) => {
    e.preventDefault();
    keys[keyName] = true;
    elem.classList.add('active');
  });
  elem.addEventListener('touchend', (e) => {
    e.preventDefault();
    keys[keyName] = false;
    elem.classList.remove('active');
  });
}

bindTouchAction(btnJump, 'Space');
bindTouchAction(btnCrouch, 'ControlLeft');
bindTouchAction(btnWalk, 'ShiftLeft');

const menuBtn = document.getElementById('menu-btn');
const settingsModal = document.getElementById('settings-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const resumeBtn = document.getElementById('resume-btn');
const touchToggle = document.getElementById('touch-toggle');
const audioToggle = document.getElementById('audio-toggle');
const sensRange = document.getElementById('sens-range');

function isMobileDevice() {
  return ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || window.innerWidth <= 768;
}

function updateTouchVisibility() {
  const showTouch = forceTouchControls || isMobileDevice();
  document.getElementById('touch-controls').classList.toggle('hidden', !showTouch);
  touchToggle.checked = showTouch;
}

menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  document.exitPointerLock();
  settingsModal.classList.remove('hidden');
});

closeModalBtn.addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});

resumeBtn.addEventListener('click', () => {
  settingsModal.classList.add('hidden');
  if (!isMobileDevice() && !forceTouchControls) {
    document.body.requestPointerLock();
  }
});

touchToggle.addEventListener('change', (e) => {
  forceTouchControls = e.target.checked;
  updateTouchVisibility();
});

audioToggle.addEventListener('change', (e) => {
  enableAudio = e.target.checked;
});

sensRange.addEventListener('input', (e) => {
  mouseSensitivity = parseFloat(e.target.value);
});

updateTouchVisibility();

function checkCollisions(newPos) {
  const playerBox = new THREE.Box3(
    new THREE.Vector3(newPos.x - PLAYER_RADIUS, newPos.y - player.eyeHeight, newPos.z - PLAYER_RADIUS),
    new THREE.Vector3(newPos.x + PLAYER_RADIUS, newPos.y + 0.2, newPos.z + PLAYER_RADIUS)
  );

  for (let collider of colliders) {
    if (playerBox.intersectsBox(collider)) {
      const overlapX = Math.min(playerBox.max.x - collider.min.x, collider.max.x - playerBox.min.x);
      const overlapZ = Math.min(playerBox.max.z - collider.min.z, collider.max.z - playerBox.min.z);

      if (overlapX < overlapZ) {
        if (newPos.x > (collider.min.x + collider.max.x) / 2) newPos.x += overlapX;
        else newPos.x -= overlapX;
      } else {
        if (newPos.z > (collider.min.z + collider.max.z) / 2) newPos.z += overlapZ;
        else newPos.z -= overlapZ;
      }
    }
  }
}

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.1);

  player.isCrouching = keys['ControlLeft'] || keys['ControlRight'];
  player.isWalking = keys['ShiftLeft'] || keys['ShiftRight'];

  const targetHeight = player.isCrouching ? CROUCH_HEIGHT : STAND_HEIGHT;
  player.eyeHeight += (targetHeight - player.eyeHeight) * 12.0 * delta;

  let speed = RUN_SPEED;
  if (player.isCrouching) speed = CROUCH_SPEED;
  else if (player.isWalking) speed = WALK_SPEED;

  let inputZ = 0;
  let inputX = 0;

  if (keys['KeyW']) inputZ -= 1;
  if (keys['KeyS']) inputZ += 1;
  if (keys['KeyA']) inputX -= 1;
  if (keys['KeyD']) inputX += 1;

  if (touchMoveVector.x !== 0 || touchMoveVector.y !== 0) {
    inputX = touchMoveVector.x;
    inputZ = touchMoveVector.y;
  }

  const moveDir = new THREE.Vector3(inputX, 0, inputZ);
  if (moveDir.lengthSq() > 1) moveDir.normalize();

  moveDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), player.rotation.y);

  const targetVelX = moveDir.x * speed;
  const targetVelZ = moveDir.z * speed;

  const accelRate = player.onGround ? 22.0 : 1.2;

  player.velocity.x += (targetVelX - player.velocity.x) * accelRate * delta;
  player.velocity.z += (targetVelZ - player.velocity.z) * accelRate * delta;

  if (keys['Space'] && player.onGround) {
    player.velocity.y = JUMP_FORCE;
    player.onGround = false;
  }

  player.velocity.y -= GRAVITY * delta;

  const nextPos = player.position.clone();
  nextPos.x += player.velocity.x * delta;
  nextPos.y += player.velocity.y * delta;
  nextPos.z += player.velocity.z * delta;

  if (nextPos.y <= player.eyeHeight) {
    nextPos.y = player.eyeHeight;
    player.velocity.y = 0;
    player.onGround = true;
  }

  checkCollisions(nextPos);
  player.position.copy(nextPos);

  camera.position.copy(player.position);
  camera.rotation.copy(player.rotation);

  const horizontalSpeed = Math.hypot(player.velocity.x, player.velocity.z);
  if (player.onGround && horizontalSpeed > 6.0 && !player.isWalking && !player.isCrouching) {
    const now = clock.getElapsedTime();
    if (now - lastStepTime > 0.38) {
      playFootstepSound();
      lastStepTime = now;
    }
  }

  drawJoystick();

  document.getElementById('hud-pos').textContent =
    `${player.position.x.toFixed(1)}, ${player.position.y.toFixed(1)}, ${player.position.z.toFixed(1)}`;

  let stateText = 'Running';
  if (!player.onGround) stateText = 'Airborne';
  else if (player.isCrouching) stateText = 'Crouching';
  else if (player.isWalking) stateText = 'Walking (Silent)';
  document.getElementById('hud-state').textContent = stateText;

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
