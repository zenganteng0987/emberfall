// foundry-map.js — one job: the Emberfall Foundry itself. It builds the three.js scenery
// (ground, furnace hall, crates, lava channels, charge sites), and exports the data the
// simulation runs on: box colliders, the waypoint graph bots walk, the two charge sites
// and both teams' spawn points. Layout, names and palette are this game's own: a dusk
// foundry yard, ember orange against deep teal, about 44 by 44 metres.

import * as THREE from 'three';

/** Half the yard's width; fighters are clamped a little inside it. */
export const BOUND = 21.3;
/** Eye height of a standing fighter, in metres. */
export const EYE = 1.62;

/** A collider box: x/z footprint plus a height, tagged with the visual kind it wears. */
function box(x0, z0, x1, z1, h, kind) {
  return { x0, z0, x1, z1, h, kind };
}

/** The solid things of the yard. Heights matter: bullets stop at them in 3D, and only
 *  boxes taller than about 1.3 m block a standing fighter's line of sight. */
const COLLIDERS = [
  // The yard's rim, just outside the playable bound, so shots stop at the walls.
  box(-23.5, -23.5, -21.6, 23.5, 5, 'rim'), box(21.6, -23.5, 23.5, 23.5, 5, 'rim'),
  box(-23.5, -23.5, 23.5, -21.6, 5, 'rim'), box(-23.5, 21.6, 23.5, 23.5, 5, 'rim'),
  // The central furnace and the hall walls around it, with a door gap at x in [-1.2, 1.2].
  box(-4, -4, 4, 4, 6, 'furnace'),
  box(-11, -7.6, -1.2, -6.4, 3, 'wall'), box(1.2, -7.6, 11, -6.4, 3, 'wall'),
  box(-11, 6.4, -1.2, 7.6, 3, 'wall'), box(1.2, 6.4, 11, 7.6, 3, 'wall'),
  // West and east dividers, each with a mid door gap at z in [-1.2, 1.2].
  box(-13.2, -8, -12, -1.2, 3, 'wall'), box(-13.2, 1.2, -12, 8, 3, 'wall'),
  box(12, -8, 13.2, -1.2, 3, 'wall'), box(12, 1.2, 13.2, 8, 3, 'wall'),
  // Slag blocks flanking the furnace inside the hall.
  box(-8.5, -2, -5.5, 2, 2.2, 'slag'), box(5.5, -2, 8.5, 2, 2.2, 'slag'),
  // Crates: honest cover in the lanes, at the hall mouths and at the sites.
  box(-8, -13.8, -6.4, -12.2, 1.6, 'crate'), box(6, -13.8, 7.6, -12.2, 1.6, 'crate'),
  box(-8, 12.2, -6.4, 13.8, 1.6, 'crate'), box(6, 12.2, 7.6, 13.8, 1.6, 'crate'),
  box(-8.5, -3.8, -6.9, -2.2, 1.6, 'crate'), box(-8.5, 2.2, -6.9, 3.8, 1.6, 'crate'),
  box(6.9, -3.8, 8.5, -2.2, 1.6, 'crate'), box(6.9, 2.2, 8.5, 3.8, 1.6, 'crate'),
  box(14.2, -9.8, 15.8, -8.2, 1.6, 'crate'), box(18.2, -16.8, 19.8, -15.2, 1.6, 'crate'),
  box(14.2, 8.2, 15.8, 9.8, 1.6, 'crate'), box(18.2, 15.2, 19.8, 16.8, 1.6, 'crate'),
  box(13.6, -15, 15.2, -13.4, 1.6, 'crate'), box(13.6, 13.4, 15.2, 15, 1.6, 'crate'),
  // Low barriers flanking the lane approaches: they stop feet, not bullets or sight.
  box(3.2, -9.8, 7.2, -9, 1.05, 'barrier'), box(-7.2, -9.8, -3.2, -9, 1.05, 'barrier'),
  box(3.2, 9, 7.2, 9.8, 1.05, 'barrier'), box(-7.2, 9, -3.2, 9.8, 1.05, 'barrier'),
];

/** Hand-placed waypoint spots in open ground; links are derived from line of sight. */
const WAYPOINT_SPOTS = [
  [-19, -4.5], [-19, 4.5], [-16, 0], [-16, -10], [-16, 10],
  [-12.6, 0], [-10, 0], [-10, -4.5], [-10, 4.5],
  [-8, -10.5], [0, -10.5], [8, -10.5], [-8, 10.5], [0, 10.5], [8, 10.5],
  [0, -5.2], [0, 5.2], [-6, -4.8], [-6, 4.8], [6, -4.8], [6, 4.8],
  [10, 0], [10, -4.5], [10, 4.5], [12.6, 0],
  [14, -10.5], [16.5, -13], [19, -8.5], [14, 10.5], [16.5, 13], [19, 8.5],
  [19.5, -11], [19.5, -3], [19.5, 3], [19.5, 11],
];

/** The two charge sites: pads in the eastern yard, A to the north, B to the south. */
export const SITES = {
  A: { id: 'A', name: 'Site A — North Crucible', x: 16.5, z: -13, r: 3.4 },
  B: { id: 'B', name: 'Site B — South Crucible', x: 16.5, z: 13, r: 3.4 },
};

/** Spawn points; yaw uses the game's convention: forward = (sin yaw, -cos yaw). */
export const SPAWNS = {
  atk: [
    { x: -20, z: -6, yaw: Math.PI / 2 }, { x: -20, z: -2, yaw: Math.PI / 2 },
    { x: -20, z: 2, yaw: Math.PI / 2 }, { x: -20, z: 6, yaw: Math.PI / 2 },
  ],
  def: [
    { x: 20, z: -11, yaw: -Math.PI / 2 }, { x: 20, z: -3, yaw: -Math.PI / 2 },
    { x: 20, z: 3, yaw: -Math.PI / 2 }, { x: 20, z: 11, yaw: -Math.PI / 2 },
  ],
};

/** Does the 2D segment cross any collider (optionally grown by `inflate`)? Only colliders
 *  taller than `minH` count, so sight lines can pass over low barriers and crates. */
export function segmentBlocked(colliders, x0, z0, x1, z1, inflate = 0, minH = 0) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  for (const c of colliders) {
    if (c.h <= minH) continue;
    let t0 = 0;
    let t1 = 1;
    const loX = c.x0 - inflate;
    const hiX = c.x1 + inflate;
    const loZ = c.z0 - inflate;
    const hiZ = c.z1 + inflate;
    if (Math.abs(dx) < 1e-9) {
      if (x0 < loX || x0 > hiX) continue;
    } else {
      let ta = (loX - x0) / dx;
      let tb = (hiX - x0) / dx;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-9) {
      if (z0 < loZ || z0 > hiZ) continue;
    } else {
      let ta = (loZ - z0) / dz;
      let tb = (hiZ - z0) / dz;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    return true;
  }
  return false;
}

/** Standing sight check between two eye points: blocked only by cover taller than 1.3 m. */
export function sightBlocked(colliders, ax, az, bx, bz) {
  return segmentBlocked(colliders, ax, az, bx, bz, 0, 1.3);
}

/** Push a circle (a fighter's feet) out of every collider it overlaps; clamps to the yard. */
export function collideCircle(colliders, pos, radius) {
  pos.x = Math.max(-BOUND, Math.min(BOUND, pos.x));
  pos.z = Math.max(-BOUND, Math.min(BOUND, pos.z));
  for (const c of colliders) {
    if (c.kind === 'rim') continue;
    const nx = Math.max(c.x0, Math.min(c.x1, pos.x));
    const nz = Math.max(c.z0, Math.min(c.z1, pos.z));
    let dx = pos.x - nx;
    let dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 > radius * radius) continue;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      pos.x = nx + (dx / d) * radius;
      pos.z = nz + (dz / d) * radius;
    } else {
      // Centre inside the box: leave by the shallowest face.
      const left = pos.x - c.x0;
      const right = c.x1 - pos.x;
      const top = pos.z - c.z0;
      const bottom = c.z1 - pos.z;
      const m = Math.min(left, right, top, bottom);
      if (m === left) pos.x = c.x0 - radius;
      else if (m === right) pos.x = c.x1 + radius;
      else if (m === top) pos.z = c.z0 - radius;
      else pos.z = c.z1 + radius;
    }
  }
  return pos;
}

/** Index of the waypoint nearest to a point (used to join and leave the graph). */
export function nearestWaypoint(waypoints, x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < waypoints.length; i += 1) {
    const d = (waypoints[i].x - x) ** 2 + (waypoints[i].z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Link every pair of waypoints that can see each other within 10.5 m of open ground. */
function linkWaypoints(colliders, spots) {
  const waypoints = spots.map(([x, z]) => ({ x, z, links: [] }));
  for (let i = 0; i < waypoints.length; i += 1) {
    for (let j = i + 1; j < waypoints.length; j += 1) {
      const a = waypoints[i];
      const b = waypoints[j];
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d > 10.5) continue;
      if (segmentBlocked(colliders, a.x, a.z, b.x, b.z, 0.45, 0)) continue;
      a.links.push(j);
      b.links.push(i);
    }
  }
  return waypoints;
}

/** A canvas texture painted in code: dark basalt plates with faint ember cracks. */
function groundTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#26292e';
  g.fillRect(0, 0, 512, 512);
  let s = 1234567;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = 0; i < 2600; i += 1) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.16)';
    g.fillRect(rnd() * 512, rnd() * 512, 2.5, 2.5);
  }
  g.strokeStyle = 'rgba(12,13,15,0.85)';
  g.lineWidth = 3;
  for (let i = 0; i <= 4; i += 1) {
    g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i * 128); g.lineTo(512, i * 128); g.stroke();
  }
  g.strokeStyle = 'rgba(255,106,34,0.20)';
  g.lineWidth = 1.4;
  for (let i = 0; i < 9; i += 1) {
    g.beginPath();
    let x = rnd() * 512;
    let y = rnd() * 512;
    g.moveTo(x, y);
    for (let k = 0; k < 5; k += 1) {
      x += (rnd() - 0.5) * 90;
      y += (rnd() - 0.5) * 90;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A canvas texture for crates: steel panels, rivets and a stencilled FOUNDRY mark. */
function crateTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#5d4a33';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#6d573d';
  g.fillRect(10, 10, 236, 236);
  g.strokeStyle = 'rgba(20,14,8,0.8)';
  g.lineWidth = 6;
  g.strokeRect(10, 10, 236, 236);
  g.beginPath(); g.moveTo(10, 10); g.lineTo(246, 246); g.moveTo(246, 10); g.lineTo(10, 246); g.stroke();
  g.fillStyle = 'rgba(255,170,90,0.75)';
  g.font = 'bold 30px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('FOUNDRY', 128, 138);
  g.fillStyle = 'rgba(15,12,8,0.9)';
  for (const [x, y] of [[24, 24], [232, 24], [24, 232], [232, 232]]) {
    g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A floating letter sprite naming a charge site. */
function siteLetter(letter, color) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.font = 'bold 96px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.6, 1.6, 1);
  return sprite;
}

const MAT = {
  wall: new THREE.MeshLambertMaterial({ color: 0x39424b }),
  rim: new THREE.MeshLambertMaterial({ color: 0x2c343c }),
  slag: new THREE.MeshLambertMaterial({ color: 0x2e2a28 }),
  furnace: new THREE.MeshLambertMaterial({ color: 0x4c3a30 }),
  barrier: new THREE.MeshLambertMaterial({ color: 0x51585e }),
};

/** Add one collider's mesh (and a thin ember trim on walls) to the scene. */
function addColliderMesh(scene, c, crateMat) {
  const w = c.x1 - c.x0;
  const d = c.z1 - c.z0;
  const mat = c.kind === 'crate' ? crateMat : MAT[c.kind] ?? MAT.wall;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, c.h, d), mat);
  mesh.position.set(c.x0 + w / 2, c.h / 2, c.z0 + d / 2);
  scene.add(mesh);
  if (c.kind === 'wall' || c.kind === 'rim') {
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.07, Math.min(d, 0.3)),
      new THREE.MeshBasicMaterial({ color: 0xff7a33 }),
    );
    trim.position.set(c.x0 + w / 2, c.h + 0.02, c.z0 + d / 2);
    scene.add(trim);
  }
  if (c.kind === 'barrier') {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.1, d),
      new THREE.MeshBasicMaterial({ color: 0xd8b13a }),
    );
    stripe.position.set(c.x0 + w / 2, c.h - 0.08, c.z0 + d / 2);
    scene.add(stripe);
  }
}

/** A glowing lava strip lying almost flat on the ground. */
function addLava(scene, x, z, w, d) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xff5a1f });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.03, z);
  scene.add(m);
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 0.9, d + 0.9),
    new THREE.MeshBasicMaterial({ color: 0x7a2c0d, transparent: true, opacity: 0.5 }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(x, 0.02, z);
  scene.add(glow);
}

/**
 * Build the whole yard into `scene` and return the simulation's map data:
 * { colliders, waypoints, sites, spawns }.
 */
export function buildFoundry(scene) {
  const colliders = COLLIDERS;
  const crateMat = new THREE.MeshLambertMaterial({ map: crateTexture() });

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(47, 47),
    new THREE.MeshLambertMaterial({ map: groundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  for (const c of colliders) addColliderMesh(scene, c, crateMat);

  // The furnace's burning core and chimney rise out of the central block.
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.9, 4.6, 12),
    new THREE.MeshBasicMaterial({ color: 0xff7a26 }),
  );
  core.position.set(0, 5.1, 0);
  scene.add(core);
  const chimney = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 1.1, 3.4, 10),
    new THREE.MeshLambertMaterial({ color: 0x33302c }),
  );
  chimney.position.set(0, 9.4, 0);
  scene.add(chimney);
  const furnaceLight = new THREE.PointLight(0xff7a33, 260, 30, 1.8);
  furnaceLight.position.set(0, 6.4, 0);
  scene.add(furnaceLight);

  // Lava channels run beside both lanes and ring the furnace plinth.
  addLava(scene, 0, -11.9, 34, 0.8);
  addLava(scene, 0, 11.9, 34, 0.8);
  addLava(scene, 0, -5.4, 11.6, 0.7);
  addLava(scene, 0, 5.4, 11.6, 0.7);
  addLava(scene, -5.4, 0, 0.7, 10.1);
  addLava(scene, 5.4, 0, 0.7, 10.1);
  const laneLightN = new THREE.PointLight(0xff5a1f, 90, 17, 1.8);
  laneLightN.position.set(-6, 1.6, -11.9);
  scene.add(laneLightN);
  const laneLightS = new THREE.PointLight(0xff5a1f, 90, 17, 1.8);
  laneLightS.position.set(6, 1.6, 11.9);
  scene.add(laneLightS);

  // Charge site pads: a lit ring on the ground and its letter floating above.
  for (const site of Object.values(SITES)) {
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(site.r, 28),
      new THREE.MeshBasicMaterial({ color: 0xff8c3b, transparent: true, opacity: 0.16 }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(site.x, 0.04, site.z);
    scene.add(pad);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.r - 0.18, site.r, 40),
      new THREE.MeshBasicMaterial({ color: 0xffa04d, transparent: true, opacity: 0.9 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.05, site.z);
    scene.add(ring);
    const letter = siteLetter(site.id, '#ffb066');
    letter.position.set(site.x, 4.4, site.z);
    scene.add(letter);
    const light = new THREE.PointLight(0xff8c3b, 40, 11, 1.8);
    light.position.set(site.x, 2.2, site.z);
    scene.add(light);
  }

  return {
    colliders,
    waypoints: linkWaypoints(colliders, WAYPOINT_SPOTS),
    sites: SITES,
    spawns: SPAWNS,
  };
}
