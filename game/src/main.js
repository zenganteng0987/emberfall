// main.js — one job: boot and the loop. It builds the renderer, the foundry, the match,
// the bots, the player, the HUD, the sounds and the effects; runs the simulation at a
// fixed 1/60 s under requestAnimationFrame; drains the match's events and fx into
// banners, kill feed, sounds and sparks; and owns the screen flow (title, buy, pause,
// match end) including pointer lock. With ?shot=title|buy|play|end&seed=N it stages a
// deterministic scene instead and raises window.__shotReady for the screenshotter.

import * as THREE from 'three';
import { createRng } from './rng.js';
import { buildFoundry, EYE } from './foundry-map.js';
import { createMatch, TEAM_NAMES } from './match.js';
import { WEAPON_BY_ID, newAmmo } from './weapons.js';
import { createBots } from './bots.js';
import { createPlayer } from './player.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.25;
const RECOIL = { pistol: 0.01, smg: 0.007, shotgun: 0.03, rifle: 0.011, sniper: 0.045 };

const params = new URLSearchParams(window.location.search);
const shotScene = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 2147483647);

// --- World ---------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
document.getElementById('app').append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x11181e);
scene.fog = new THREE.Fog(0x141c22, 22, 58);
const hemi = new THREE.HemisphereLight(0x46626e, 0x201409, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xff9a4d, 1.15);
sun.position.set(-18, 24, -10);
scene.add(sun);
if (shotScene) {
  // Screenshot staging renders through a software rasteriser that reads dark:
  // lift the exposure and ambient a touch so the staged frames match what a
  // player sees on a real GPU. Normal play keeps the values above.
  renderer.toneMappingExposure = 1.38;
  hemi.intensity = 1.3;
  scene.fog = new THREE.Fog(0x141c22, 30, 78);
}

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, 120);
const map = buildFoundry(scene);
const rng = createRng(seed);
const match = createMatch(map, rng);
const bots = createBots(match);
bots.buildMeshes(scene);
const audio = createAudio();
const effects = createEffects(scene, createRng(seed ^ 0x5f3759df));
const player = createPlayer(match, camera, renderer.domElement, scene);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Screen flow -----------------------------------------------------------
let started = false;
let paused = false;
let locked = false;

const hud = createHud({
  onPlay: () => beginMatch(),
  onAgain: () => beginMatch(),
  onResume: () => lockPointer(),
  onBuy: (weaponId) => {
    if (match.buyWeapon(match.fighters[0], weaponId)) hud.refreshBuy(match);
  },
});

function lockPointer() {
  renderer.domElement.requestPointerLock();
}

function beginMatch() {
  audio.unlock();
  audio.click();
  started = true;
  paused = false;
  hud.setHudVisible(true);
  hud.showScreen(null);
  player.setActive(true);
  match.startMatch();
  drainEvents();
}

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (locked) {
    hud.setLockPrompt(false);
    if (paused) {
      paused = false;
      hud.showScreen(null);
      player.setActive(true);
    }
  } else if (started && !shotScene && match.phase === 'live' && !paused) {
    paused = true;
    player.setActive(false);
    hud.showScreen('pause');
  }
});

renderer.domElement.addEventListener('click', () => {
  if (started && !locked && !paused && match.phase === 'live') lockPointer();
});
document.getElementById('buy-menu').addEventListener('click', (e) => {
  if (e.target.id === 'buy-menu' && started && !locked) lockPointer();
});

window.addEventListener('keydown', (e) => {
  if (!started) return;
  if (e.code.startsWith('Digit')) {
    const n = Number.parseInt(e.code.slice(5), 10);
    const weapon = [null, 'p9', 'k7', 'm870', 'ar4', 'longshot'][n];
    if (weapon && match.phase === 'buy' && match.buyWeapon(match.fighters[0], weapon)) {
      hud.refreshBuy(match);
    }
  }
  if (e.code === 'KeyM') {
    hud.toast(audio.setMuted(!audio.isMuted()) ? 'Sound off' : 'Sound on');
  }
  if (e.code === 'KeyP') {
    if (paused) lockPointer();
    else if (locked) document.exitPointerLock();
  }
});

// --- Events and fx -----------------------------------------------------------

const ROUND_REASONS = {
  elimination: 'by elimination',
  detonation: 'the core charge detonated',
  defused: 'the core charge was defused',
  time: 'the clock ran out',
};

function drainEvents() {
  for (const ev of match.events) {
    if (ev.type === 'roundStart') {
      bots.planRound();
      hud.refreshBuy(match);
      if (match.phase === 'buy' && !shotScene) hud.showScreen('buy');
      const carrier = match.fighters[ev.carrierId];
      hud.banner(
        `Round ${ev.round}`,
        carrier.isPlayer ? 'You carry the core charge' : `${carrier.name} carries the core charge`,
        '',
        2.2,
      );
    } else if (ev.type === 'live') {
      hud.showScreen(null);
      if (!locked && !shotScene) hud.setLockPrompt(true);
    } else if (ev.type === 'kill') {
      const killer = match.fighters[ev.srcId];
      const victim = match.fighters[ev.dstId];
      hud.feed(killer, victim, WEAPON_BY_ID[ev.weaponId].name, ev.head);
      if (killer.isPlayer) {
        hud.hitmark(true);
        hud.killConfirm(victim.name, ev.head);
        audio.hit(true);
      }
    } else if (ev.type === 'hit') {
      const src = match.fighters[ev.srcId];
      const dst = match.fighters[ev.dstId];
      if (src.isPlayer) {
        hud.hitmark(false);
        hud.damageDealt(ev.dmg);
        audio.hit(false);
      }
      if (dst.isPlayer) {
        const bearing = Math.atan2(src.pos.x - dst.pos.x, -(src.pos.z - dst.pos.z));
        hud.damageFrom(bearing - dst.yaw);
        effects.addShake(0.16);
      }
    } else if (ev.type === 'planted') {
      hud.banner('Charge planted', `Site ${ev.site} — 40 seconds`, 'atk', 2.4);
    } else if (ev.type === 'chargeDropped') {
      hud.toast('The core charge is down');
    } else if (ev.type === 'chargePickup') {
      const who = match.fighters[ev.byId];
      hud.toast(who.isPlayer ? 'You have the core charge' : `${who.name} has the core charge`);
    } else if (ev.type === 'roundEnd') {
      hud.banner(
        `${TEAM_NAMES[ev.winner]} take the round`,
        `Round ${ev.round} — ${ROUND_REASONS[ev.reason] ?? ''} · ${TEAM_NAMES.atk} ${match.wins.atk} — ${match.wins.def} ${TEAM_NAMES.def}`,
        ev.winner,
        3.4,
      );
      audio.sting(ev.winner === 'atk');
      hud.showScreen(null);
      hud.setLockPrompt(false);
    } else if (ev.type === 'matchEnd') {
      player.setActive(false);
      if (document.pointerLockElement) document.exitPointerLock();
      hud.showEnd(match);
    }
  }
  match.events.length = 0;
}

function drainFx() {
  const me = match.fighters[0];
  for (const fx of match.fx) {
    if (fx.type === 'tracer') {
      effects.tracer(fx.x0, fx.y0, fx.z0, fx.x1, fx.y1, fx.z1, fx.team);
    } else if (fx.type === 'impact') {
      effects.impact(fx.x, fx.y, fx.z, fx.flesh);
    } else if (fx.type === 'muzzle') {
      const fighter = match.fighters[fx.fighter];
      effects.muzzle(fighter);
      if (fighter.isPlayer) player.applyRecoil(RECOIL[WEAPON_BY_ID[fighter.weaponId].kind] ?? 0.01);
    } else if (fx.type === 'explosion') {
      effects.explosion(fx.x, fx.z);
      audio.explosion();
    } else if (fx.type === 'sound') {
      if (fx.name === 'shot') {
        const d = fx.by === 0 ? 0 : Math.hypot(fx.x - me.pos.x, fx.z - me.pos.z);
        audio.shot(fx.kind, fx.by === 0 ? 1 : Math.max(0.1, 1 - d / 48));
      } else if (fx.name === 'dry' && fx.by === 0) audio.dry();
      else if (fx.name === 'reload' && fx.by === 0) audio.reload();
      else if (fx.name === 'buy' && fx.by === 0) audio.buy();
      else if (fx.name === 'beep') {
        const src = match.fighters[fx.by];
        if (fx.by === 0 || Math.hypot(src.pos.x - me.pos.x, src.pos.z - me.pos.z) < 13) audio.beep(fx.final);
      } else if (fx.name === 'defused') audio.defused();
    }
  }
  match.fx.length = 0;
}

// --- Screenshot staging ------------------------------------------------------

function giveWeapon(f, id) {
  f.weaponId = id;
  f.ammo = newAmmo(WEAPON_BY_ID[id]);
}

/** Run the simulation with no human at the keys (screenshot scenes only). */
function simSteps(n) {
  for (let i = 0; i < n; i += 1) {
    bots.step(STEP);
    match.step(STEP);
    if (i % 60 === 59) {
      drainEvents();
      match.fx.length = 0;
    }
  }
  drainEvents();
  match.fx.length = 0;
}

function stageShot(name) {
  started = true;
  hud.setHudVisible(true);
  player.setActive(false);
  if (name === 'buy') {
    match.startMatch();
    drainEvents();
    match.phaseT = 8.5;
    hud.showScreen('buy');
    hud.update(match);
    hud.clearBanner();
    hud.clearCharge();
    return 'player';
  }
  if (name === 'play') {
    match.startMatch();
    drainEvents();
    giveWeapon(match.fighters[0], 'ar4');
    giveWeapon(match.fighters[1], 'ar4');
    giveWeapon(match.fighters[2], 'k7');
    giveWeapon(match.fighters[3], 'ar4');
    giveWeapon(match.fighters[4], 'ar4');
    giveWeapon(match.fighters[5], 'ar4');
    giveWeapon(match.fighters[6], 'k7');
    giveWeapon(match.fighters[7], 'longshot');
    match.forceLive();
    const me = match.fighters[0];
    me.god = true;
    me.pos.x = 8;
    me.pos.z = -10.5;
    me.yaw = Math.PI / 2;
    simSteps(60 * 11);
    if (match.phase === 'roundEnd') {
      match.phase = 'live';
      match.phaseT = 47;
    }
    me.pos.x = 8;
    me.pos.z = -10.5;
    me.yaw = Math.PI / 2;
    me.pitch = 0;
    hud.showScreen(null);
    hud.update(match);
    hud.clearBanner();
    return 'player';
  }
  if (name === 'end') {
    match.startMatch();
    drainEvents();
    for (let round = 0; round < 3 && match.phase !== 'matchEnd'; round += 1) {
      match.forceLive();
      let guard = 0;
      while (match.phase === 'live' && guard < 60 * 95) {
        bots.step(STEP);
        match.step(STEP);
        guard += 1;
        if (guard % 60 === 0) match.fx.length = 0;
      }
      match.fx.length = 0;
      match.events.length = 0;
      guard = 0;
      while (match.phase === 'roundEnd' && guard < 60 * 6) {
        match.step(STEP);
        guard += 1;
      }
      drainEvents();
    }
    match.stageMatchEnd(5, 3);
    hud.showEnd(match);
    hud.clearBanner();
    hud.update(match);
    return 'cine';
  }
  match.stageTitle();
  hud.showScreen('title');
  return 'cine';
}

// --- The loop ------------------------------------------------------------------

let shotCamera = null;
if (shotScene) shotCamera = stageShot(shotScene);
else {
  match.stageTitle();
  hud.showScreen('title');
}

let last = performance.now();
let accumulator = 0;
let elapsed = 0;
let frames = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, MAX_FRAME);
  last = now;
  elapsed += dt;

  if (shotScene) {
    bots.syncMeshes();
    effects.syncCharge(match, 1 / 60);
    effects.update(1 / 60);
    if (shotCamera === 'player') player.updateCamera(1 / 60, { x: 0, y: 0, roll: 0 });
    else {
      camera.position.set(15.5, 7.5, 16.5);
      camera.lookAt(0, 1.4, 0);
    }
    renderer.render(scene, camera);
    frames += 1;
    if (frames >= 4) window.__shotReady = true;
    return;
  }

  if (started && !paused && match.phase !== 'matchEnd') {
    accumulator += dt;
    while (accumulator >= STEP) {
      player.step();
      bots.step(STEP);
      match.step(STEP);
      accumulator -= STEP;
    }
    drainEvents();
    drainFx();
  }

  bots.syncMeshes();
  effects.syncCharge(match, dt);
  effects.update(dt);
  if (started && match.phase !== 'title') {
    player.updateCamera(dt, effects.shakeOffset());
  } else {
    const a = elapsed * 0.045;
    camera.position.set(Math.sin(a) * 17, 8.5, Math.cos(a) * 17);
    camera.lookAt(0, 1.4, 0);
  }
  if (started) hud.update(match);
  hud.tick(dt);
  renderer.render(scene, camera);
}

requestAnimationFrame(frame);
export { EYE };
