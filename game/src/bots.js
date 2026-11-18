// bots.js — one job: the seven bot fighters. It gives each bot a brain (a plan for the
// round, a path along the foundry's waypoint graph, eyes that check line of sight, and
// simple states: advance, engage, hold, plant, defuse, fetch the dropped charge, flank
// by a two-leg route, roam between two posts) and a
// body (the low-poly fighter meshes the renderer shows, with team colours and name
// plates). Bots only ever write their fighter's intent; match.js moves and shoots them.

import * as THREE from 'three';
import { EYE, nearestWaypoint, sightBlocked } from './foundry-map.js';
import { WEAPON_BY_ID, startReload } from './weapons.js';
import { rngRange } from './rng.js';

const TEAM_COLOR = { atk: 0xb5502a, def: 0x1f7a72 };
const TEAM_VISOR = { atk: 0xffa04d, def: 0x3fe0d0 };
const PERCEIVE_EVERY = 0.1;
const SIGHT_RANGE = 42;

/** Breadth-first path over the waypoint graph, as a list of {x, z} steps. */
function findPath(map, fromX, fromZ, toX, toZ) {
  const wps = map.waypoints;
  const start = nearestWaypoint(wps, fromX, fromZ);
  const goal = nearestWaypoint(wps, toX, toZ);
  if (start === goal) return [{ x: toX, z: toZ }];
  const prev = new Array(wps.length).fill(-1);
  const seen = new Array(wps.length).fill(false);
  const queue = [start];
  seen[start] = true;
  while (queue.length) {
    const cur = queue.shift();
    if (cur === goal) break;
    for (const next of wps[cur].links) {
      if (!seen[next]) {
        seen[next] = true;
        prev[next] = cur;
        queue.push(next);
      }
    }
  }
  if (!seen[goal]) return [{ x: toX, z: toZ }];
  const path = [];
  let cur = goal;
  while (cur !== -1) {
    path.push({ x: wps[cur].x, z: wps[cur].z });
    cur = prev[cur];
  }
  path.reverse();
  path.push({ x: toX, z: toZ });
  return path;
}

/** A bot's working memory: its goal, its path, who it can see and how long it has aimed.
 *  `legs` is a route of follow-on goals (a flanker's way in); `roamPoints` with
 *  `holdT` makes a defender alternate between two posts, watching each a while. */
function makeBrain(rng) {
  return {
    goal: null, goalKind: 'hold', path: [], pathI: 0, repathT: rngRange(rng, 0, 2),
    thinkT: rngRange(rng, 0, PERCEIVE_EVERY), targetId: -1, lastSeen: null, seenAgo: 9,
    aimT: 0, reaction: rngRange(rng, 0.3, 0.55), burstT: 0, bursting: false,
    scanPhase: rngRange(rng, 0, Math.PI * 2), strafeDir: 1, strafeT: 0,
    legs: [], holdT: 0, roamPoints: null, roamI: 0,
  };
}

/** A name plate sprite worn above a bot's head. */
function namePlate(name, team) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 56;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(8,10,12,0.55)';
  g.fillRect(28, 8, 200, 40);
  g.fillStyle = team === 'atk' ? '#ffa04d' : '#3fe0d0';
  g.fillRect(28, 44, 200, 4);
  g.fillStyle = '#f2ede6';
  g.font = 'bold 26px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(name, 128, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(1.8, 0.4, 1);
  sprite.position.y = 2.1;
  return sprite;
}

const GUN_LENGTH = { pistol: 0.34, smg: 0.5, shotgun: 0.62, rifle: 0.66, sniper: 0.95 };

/** Build the visible body for one bot fighter. */
function buildBody(f) {
  const group = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: 0x23262a });
  const team = new THREE.MeshLambertMaterial({ color: TEAM_COLOR[f.team] });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.75, 0.26), dark);
  legs.position.y = 0.375;
  group.add(legs);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.62, 0.3), team);
  torso.position.y = 1.06;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshLambertMaterial({ color: 0x2b2b2b }));
  head.position.y = 1.58;
  group.add(head);
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.07, 0.32),
    new THREE.MeshBasicMaterial({ color: TEAM_VISOR[f.team] }),
  );
  visor.position.y = 1.6;
  group.add(visor);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.6), dark);
  gun.position.set(0.17, 1.3, -0.32);
  gun.name = 'gun';
  group.add(gun);
  group.add(namePlate(f.name, f.team));
  return group;
}

/**
 * Create the bot controller for a match. planRound() is called on every round start,
 * step(dt) before every simulation step, and the meshes follow the fighters.
 */
export function createBots(match) {
  const rng = match.rng;
  // The bots' own clock, advanced only by simulation steps: aim wobble and scanning
  // read it instead of the wall clock, so a seeded match replays exactly.
  let simNow = 0;
  const brains = new Map();
  for (const f of match.fighters) {
    if (!f.isPlayer) brains.set(f.id, makeBrain(rng));
  }
  const meshes = new Map();

  /** Round plan: attackers push the planned site, defenders split across both. */
  function planRound() {
    const sites = match.map.sites;
    const target = sites[match.targetSite];
    const other = sites[match.targetSite === 'A' ? 'B' : 'A'];
    for (const b of brains.values()) {
      b.legs = [];
      b.holdT = 0;
      b.roamPoints = null;
      b.roamI = 0;
    }
    const defs = match.fighters.filter((f) => f.team === 'def');
    const defGoals = [
      { x: 14, z: target.z > 0 ? 10.5 : -10.5, kind: 'hold' },
      { x: 19, z: target.z > 0 ? 8.5 : -8.5, kind: 'hold' },
      { x: 14, z: other.z > 0 ? 10.5 : -10.5, kind: 'hold' },
      { x: 12.6, z: 0, kind: 'hold' },
    ];
    defs.forEach((f, i) => {
      const b = brains.get(f.id);
      b.goal = defGoals[i % defGoals.length];
      b.goalKind = 'hold';
      b.path = [];
    });
    // The fourth Warden roams: mid first, then a site post, then the other one,
    // so the defence is never standing exactly where it stood last round.
    const roamer = defs[3];
    if (roamer) {
      const b = brains.get(roamer.id);
      b.roamPoints = [
        { x: defGoals[0].x, z: defGoals[0].z },
        { x: defGoals[2].x, z: defGoals[2].z },
      ];
      b.holdT = 2.5;
    }
    for (const f of match.fighters) {
      if (f.team !== 'atk' || f.isPlayer) continue;
      const b = brains.get(f.id);
      if (match.charge.carrierId === f.id) {
        b.goal = { x: target.x, z: target.z, kind: 'plant' };
      } else if (f.id === 2) {
        b.goal = { x: other.x, z: other.z, kind: 'probe' }; // Rook feels out the far site.
      } else if (f.id === 3) {
        // Vesper flanks: in through the mid door, then onto the planned site, so
        // Ember never arrives from one direction only.
        b.goal = { x: 12.6, z: 0, kind: 'flank' };
        b.legs = [{ x: target.x + rngRange(rng, -2, 2), z: target.z + rngRange(rng, -2, 2), kind: 'push' }];
      } else {
        b.goal = { x: target.x + rngRange(rng, -2, 2), z: target.z + rngRange(rng, -2, 2), kind: 'push' };
      }
      b.goalKind = b.goal.kind;
      b.path = [];
    }
    buyRound();
  }

  /** Bots shop by simple rules: the best gun the purse honestly affords. */
  function buyRound() {
    for (const f of match.fighters) {
      if (f.isPlayer) continue;
      if (f.money >= 3400 && rng() < 0.3) match.buyWeapon(f, 'longshot');
      else if (f.money >= 2700) match.buyWeapon(f, 'ar4');
      else if (f.money >= 1600 && rng() < 0.5) match.buyWeapon(f, 'm870');
      else if (f.money >= 1200) match.buyWeapon(f, 'k7');
    }
  }

  /** Refresh what one bot can see: the nearest enemy with a clear line of sight. */
  function perceive(f, b, dt) {
    b.thinkT -= dt;
    b.seenAgo += dt;
    if (b.thinkT > 0) return;
    b.thinkT = PERCEIVE_EVERY;
    let best = null;
    let bestD = SIGHT_RANGE;
    for (const o of match.fighters) {
      if (o.team === f.team || !o.alive) continue;
      const d = Math.hypot(o.pos.x - f.pos.x, o.pos.z - f.pos.z);
      if (d > bestD) continue;
      const facing = Math.atan2(o.pos.x - f.pos.x, -(o.pos.z - f.pos.z));
      let diff = Math.abs(((facing - f.yaw) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
      if (diff > 1.9 && d > 7) continue;
      if (sightBlocked(match.map.colliders, f.pos.x, f.pos.z, o.pos.x, o.pos.z)) continue;
      best = o;
      bestD = d;
    }
    if (best) {
      b.targetId = best.id;
      b.lastSeen = { x: best.pos.x, z: best.pos.z };
      b.seenAgo = 0;
    } else if (b.seenAgo > 2.5) {
      b.targetId = -1;
      b.lastSeen = null;
    }
  }

  /** Steer the fighter along its path; returns true when the goal is reached. */
  function followPath(f, b, dt) {
    if (!b.goal) return true;
    b.repathT -= dt;
    if (b.path.length === 0 || b.repathT <= 0) {
      b.path = findPath(match.map, f.pos.x, f.pos.z, b.goal.x, b.goal.z);
      b.pathI = 0;
      b.repathT = 2.5;
    }
    while (b.pathI < b.path.length) {
      const node = b.path[b.pathI];
      if (Math.hypot(node.x - f.pos.x, node.z - f.pos.z) < 0.7) b.pathI += 1;
      else break;
    }
    if (b.pathI >= b.path.length) {
      f.intent.mx = 0;
      f.intent.mz = 0;
      return true;
    }
    const node = b.path[b.pathI];
    const dx = node.x - f.pos.x;
    const dz = node.z - f.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    f.intent.mx = dx / d;
    f.intent.mz = dz / d;
    const wantYaw = Math.atan2(dx, -dz);
    f.yaw = turnToward(f.yaw, wantYaw, dt * 7);
    f.pitch = 0;
    return false;
  }

  /** Engage a seen enemy: track it, strafe a little, fire in bursts once settled. */
  function engage(f, b, target, dt) {
    const dx = target.pos.x - f.pos.x;
    const dz = target.pos.z - f.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const err = Math.max(0.008, 0.085 - b.aimT * 0.055);
    const wobble = Math.sin(simNow * 1.6 + f.id * 2.3) * err;
    f.yaw = turnToward(f.yaw, Math.atan2(dx, -dz) + wobble, dt * 10);
    f.pitch = Math.atan2(1.05 - EYE, dist);
    f.aimSpreadMul = 1.45;
    b.strafeT -= dt;
    if (b.strafeT <= 0) {
      b.strafeDir = rng() < 0.5 ? -1 : 1;
      b.strafeT = rngRange(rng, 0.5, 1.1);
    }
    if (dist > 9) {
      f.intent.mx = dx / dist;
      f.intent.mz = dz / dist;
    } else {
      f.intent.mx = (-dz / dist) * b.strafeDir * 0.7;
      f.intent.mz = (dx / dist) * b.strafeDir * 0.7;
    }
    b.burstT -= dt;
    if (b.burstT <= 0) {
      b.bursting = !b.bursting;
      b.burstT = b.bursting ? rngRange(rng, 0.25, 0.5) : rngRange(rng, 0.22, 0.5);
    }
    const settled = b.aimT > b.reaction;
    f.intent.fire = b.bursting && settled;
    f.intent.firePressed = f.intent.fire;
    if (f.ammo.mag === 0) startReload(match, f);
  }

  /** One bot's decision for this step. */
  function think(f, b, dt) {
    f.intent.mx = 0;
    f.intent.mz = 0;
    f.intent.fire = false;
    f.intent.firePressed = false;
    f.intent.channel = false;
    f.aimSpreadMul = 1;
    if (!f.alive || match.phase === 'buy') return;
    perceive(f, b, dt);
    const charge = match.charge;

    // The planted charge rearranges everyone's priorities.
    if (charge.state === 'planted') {
      b.legs = [];
      if (f.team === 'def') {
        b.goal = { x: charge.x, z: charge.z, kind: 'defuse' };
        b.goalKind = 'defuse';
      } else if (f.team === 'atk') {
        b.goal = { x: charge.x, z: charge.z, kind: 'guard' };
        b.goalKind = 'guard';
      }
    } else if (charge.state === 'dropped' && f.team === 'atk') {
      const carrier = match.aliveOf('atk').every((o) => o.id === f.id
        || Math.hypot(o.pos.x - charge.x, o.pos.z - charge.z) >= Math.hypot(f.pos.x - charge.x, f.pos.z - charge.z));
      if (carrier) {
        b.goal = { x: charge.x, z: charge.z, kind: 'fetch' };
        b.goalKind = 'fetch';
        b.legs = [];
      }
    } else if (charge.state === 'carried' && charge.carrierId === f.id) {
      const site = match.map.sites[match.targetSite];
      b.goal = { x: site.x, z: site.z, kind: 'plant' };
      b.goalKind = 'plant';
      b.legs = [];
    }

    const target = b.targetId >= 0 ? match.fighters[b.targetId] : null;
    const engaged = target && target.alive && b.seenAgo < 0.3;
    if (engaged) {
      b.aimT += dt;
      engage(f, b, target, dt);
      return;
    }
    b.aimT = Math.max(0, b.aimT - dt * 2);

    const arrived = followPath(f, b, dt);
    if (!arrived) return;
    // A flanker walks a route of legs: reaching one hands over to the next.
    if (b.legs.length > 0) {
      const next = b.legs.shift();
      b.goal = next;
      b.goalKind = next.kind;
      b.path = [];
      return;
    }
    if (b.goalKind === 'plant' && charge.state === 'carried' && charge.carrierId === f.id) {
      f.intent.channel = true;
      f.yaw = turnToward(f.yaw, f.team === 'atk' ? Math.PI / 2 : -Math.PI / 2, dt * 4);
    } else if (b.goalKind === 'defuse' && charge.state === 'planted') {
      f.intent.channel = true;
    } else {
      // Holding: watch the approaches, sweeping a slow arc. A roamer holds its
      // post a few seconds, then walks to its other post and holds there instead.
      if (b.roamPoints) {
        if (b.holdT > 0) {
          b.holdT -= dt;
        } else {
          b.roamI = (b.roamI + 1) % b.roamPoints.length;
          b.goal = { ...b.roamPoints[b.roamI], kind: 'roam' };
          b.goalKind = 'roam';
          b.path = [];
          b.holdT = 3.5;
          return;
        }
      }
      f.yaw += Math.sin(simNow * 0.6 + b.scanPhase) * dt * 0.55;
      f.pitch = 0;
      if (f.ammo.mag < WEAPON_BY_ID[f.weaponId].mag * 0.4) startReload(match, f);
    }
  }

  return {
    planRound,
    /** Fill every bot's intent for the coming simulation step. */
    step(dt) {
      simNow += dt;
      for (const f of match.fighters) {
        if (f.isPlayer) continue;
        think(f, brains.get(f.id), dt);
      }
    },
    /** Create the bot bodies in the scene (the player has a viewmodel instead). */
    buildMeshes(scene) {
      for (const f of match.fighters) {
        if (f.isPlayer) continue;
        const mesh = buildBody(f);
        meshes.set(f.id, mesh);
        scene.add(mesh);
      }
    },
    /** Move the bodies to their fighters; the dead lie where they fell. */
    syncMeshes() {
      for (const [id, mesh] of meshes) {
        const f = match.fighters[id];
        mesh.position.set(f.pos.x, 0, f.pos.z);
        if (f.alive) {
          mesh.rotation.set(0, -f.yaw, 0);
          const gun = mesh.getObjectByName('gun');
          if (gun) gun.scale.z = (GUN_LENGTH[WEAPON_BY_ID[f.weaponId].kind] ?? 0.6) / 0.6;
        } else {
          mesh.rotation.set(-Math.PI / 2, 0, 0);
          mesh.position.y = 0.16;
        }
        if (f.alive) mesh.position.y = 0;
      }
    },
  };
}

/** Turn an angle toward a target by at most `maxStep`, the short way round. */
function turnToward(current, target, maxStep) {
  let diff = ((target - current) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  diff = Math.max(-maxStep, Math.min(maxStep, diff));
  return current + diff;
}
