// player.js — one job: the human at the keyboard. It turns WASD, the mouse (through
// pointer lock), the trigger, the reload key and the E channel into the player
// fighter's intent, drives the camera from the fighter's eyes (with aim-down-sights
// zoom on the Longshot and a visual recoil kick), and builds the little gun viewmodel
// the player sees in their own hands. It never moves the fighter itself: match.js does.

import * as THREE from 'three';
import { EYE } from './foundry-map.js';
import { WEAPON_BY_ID, startReload } from './weapons.js';

const SENS = 0.0021;
const PITCH_MAX = 1.35;
const HIP_FOV = 72;

const VM_PARTS = {
  pistol: { len: 0.3, body: 0.34, color: 0x3a3f45 },
  smg: { len: 0.44, body: 0.46, color: 0x35424a },
  shotgun: { len: 0.58, body: 0.5, color: 0x4a3a2c },
  rifle: { len: 0.62, body: 0.54, color: 0x2f3a33 },
  sniper: { len: 0.92, body: 0.6, color: 0x2c2f36 },
};

/** Build the viewmodel gun for a weapon kind: receiver, barrel, grip, ember stripe. */
function buildViewmodel(kind) {
  const spec = VM_PARTS[kind] ?? VM_PARTS.rifle;
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: spec.color });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1d2023 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.15, spec.body), mat);
  group.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, spec.len, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.035, -(spec.body / 2 + spec.len / 2));
  group.add(barrel);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.17, 0.09), dark);
  grip.position.set(0, -0.14, 0.1);
  grip.rotation.x = 0.35;
  group.add(grip);
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.095, 0.03, spec.body * 0.7),
    new THREE.MeshBasicMaterial({ color: 0xff7a33 }),
  );
  stripe.position.y = 0.045;
  group.add(stripe);
  if (kind === 'sniper') {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.2, 8), dark);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.11, -0.05);
    group.add(scope);
  }
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.34),
    new THREE.MeshBasicMaterial({ color: 0xffc37a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  flash.position.set(0, 0.035, -(spec.body / 2 + spec.len + 0.05));
  flash.name = 'flash';
  group.add(flash);
  group.position.set(0.24, -0.24, -0.45);
  return group;
}

/**
 * Create the player controller. `step()` fills the fighter's intent before each
 * simulation step; `updateCamera(dt, shake)` runs once per rendered frame.
 */
export function createPlayer(match, camera, canvas, scene) {
  const fighter = match.fighters[0];
  const keys = new Set();
  let active = false;
  let mouseDown = false;
  let aiming = false;
  let pendingPress = false;
  let recoil = 0;
  let flashT = 0;
  let vmKind = null;
  let viewmodel = null;

  scene.add(camera);
  camera.rotation.order = 'YXZ';

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR' && active) startReload(match, fighter);
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  document.addEventListener('mousemove', (e) => {
    if (!active || document.pointerLockElement !== canvas) return;
    fighter.yaw += e.movementX * SENS;
    fighter.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, fighter.pitch - e.movementY * SENS));
  });
  document.addEventListener('mousedown', (e) => {
    if (!active || document.pointerLockElement !== canvas) return;
    if (e.button === 0) {
      mouseDown = true;
      pendingPress = true;
    }
    if (e.button === 2) aiming = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouseDown = false;
    if (e.button === 2) aiming = false;
  });
  document.addEventListener('contextmenu', (e) => {
    if (document.pointerLockElement === canvas) e.preventDefault();
  });

  /** Swap the viewmodel when the fighter's weapon changes. */
  function syncViewmodel() {
    const kind = WEAPON_BY_ID[fighter.weaponId].kind;
    if (kind === vmKind) return;
    vmKind = kind;
    if (viewmodel) camera.remove(viewmodel);
    viewmodel = buildViewmodel(kind);
    camera.add(viewmodel);
  }

  return {
    /** Input counts only while the match has the player's attention. */
    setActive(value) {
      active = value;
      if (!value) {
        mouseDown = false;
        aiming = false;
        fighter.intent.fire = false;
        fighter.intent.firePressed = false;
        fighter.intent.channel = false;
        fighter.intent.mx = 0;
        fighter.intent.mz = 0;
      }
    },
    isAiming: () => aiming,
    /** A shot's kick: viewmodel jumps, the camera's visual pitch rides up and settles. */
    applyRecoil(amount) {
      recoil = Math.min(0.05, recoil + amount);
      flashT = 0.045;
    },
    /** Fill the player fighter's intent from the keys and mouse, once per sim step. */
    step() {
      if (!active || !fighter.alive) {
        if (!fighter.alive) {
          fighter.intent.mx = 0;
          fighter.intent.mz = 0;
          fighter.intent.fire = false;
          fighter.intent.channel = false;
        }
        return;
      }
      const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      const fx = Math.sin(fighter.yaw);
      const fz = -Math.cos(fighter.yaw);
      const rx = Math.cos(fighter.yaw);
      const rz = Math.sin(fighter.yaw);
      fighter.intent.mx = fx * fwd + rx * strafe;
      fighter.intent.mz = fz * fwd + rz * strafe;
      fighter.intent.fire = mouseDown;
      fighter.intent.firePressed = pendingPress;
      pendingPress = false;
      fighter.intent.channel = keys.has('KeyE');
      fighter.aimSpreadMul = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 0.55 : 1;
    },
    /** Place the camera in the fighter's eyes and keep the viewmodel honest. */
    updateCamera(dt, shake) {
      syncViewmodel();
      recoil = Math.max(0, recoil - dt * 0.35);
      if (viewmodel) {
        viewmodel.position.z = -0.45 + recoil * 1.6;
        viewmodel.position.y = -0.24 + recoil * 0.5;
        const flash = viewmodel.getObjectByName('flash');
        if (flash) {
          flashT -= dt;
          flash.material.opacity = flashT > 0 ? 0.9 : 0;
          if (flashT > 0) flash.rotation.z = performance.now() * 0.02;
        }
      }
      camera.position.set(fighter.pos.x + shake.x, EYE + shake.y, fighter.pos.z);
      camera.rotation.set(fighter.pitch + recoil, -fighter.yaw, shake.roll);
      const weapon = WEAPON_BY_ID[fighter.weaponId];
      const targetFov = aiming && fighter.alive ? (weapon.scope ? 26 : 58) : HIP_FOV;
      if (Math.abs(camera.fov - targetFov) > 0.05) {
        camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 11);
        camera.updateProjectionMatrix();
      }
    },
  };
}
