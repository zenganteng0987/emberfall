// weapons.js — one job: the five weapons and how a shot is resolved. It holds the weapon
// table (price, damage, spread, falloff, magazine), turns a fighter's yaw and pitch into
// a direction, traces that ray against the yard's boxes and the enemy fighters (cylinder
// bodies, a smaller head sphere worth a multiplier), and runs each fighter's trigger:
// cooldowns, reloads, pellets, tracers and damage all start here.

import { EYE } from './foundry-map.js';

/** The armoury, in buy-menu order (keys 1-5). Damage is per pellet that lands.
 *  `bloom` is the spread heat one shot adds: sustained fire widens the cone until
 *  the trigger rests, so each gun has its own rhythm — tap the P9, burst the AR-4,
 *  and never lean on the Longshot. `blurb` is the buy card's one-line character. */
export const WEAPONS = [
  { id: 'p9', name: 'P9 Pistol', price: 0, damage: 26, headMult: 3.4, rpm: 380, mag: 12, reserve: 48, spread: 0.011, pellets: 1, auto: false, reload: 1.1, move: 1.0, fall: { from: 14, to: 46, min: 0.5 }, kind: 'pistol', bloom: 0.1, blurb: 'Sidearm — crisp and honest, free every round' },
  { id: 'k7', name: 'K7 SMG', price: 1200, damage: 21, headMult: 3.0, rpm: 780, mag: 28, reserve: 84, spread: 0.02, pellets: 1, auto: true, reload: 1.6, move: 1.03, fall: { from: 10, to: 34, min: 0.45 }, kind: 'smg', bloom: 0.06, blurb: 'Spray gun — loud, fast and best up close' },
  { id: 'm870', name: 'M870 Shotgun', price: 1600, damage: 10, headMult: 1.8, rpm: 68, mag: 6, reserve: 24, spread: 0.055, pellets: 8, auto: false, reload: 2.4, move: 1.04, fall: { from: 6, to: 20, min: 0.25 }, kind: 'shotgun', bloom: 0.25, blurb: 'Room clearer — eight pellets, one slow pump' },
  { id: 'ar4', name: 'AR-4 Rifle', price: 2700, damage: 33, headMult: 3.6, rpm: 640, mag: 25, reserve: 75, spread: 0.014, pellets: 1, auto: true, reload: 1.9, move: 0.98, fall: { from: 18, to: 55, min: 0.6 }, kind: 'rifle', bloom: 0.07, blurb: 'All-round rifle — the foundry standard' },
  { id: 'longshot', name: 'Longshot Sniper', price: 3400, damage: 96, headMult: 2.0, rpm: 42, mag: 5, reserve: 15, spread: 0.0015, pellets: 1, auto: false, reload: 2.6, move: 0.94, fall: null, kind: 'sniper', scope: true, bloom: 0.4, blurb: 'Long lanes — one shot ends it; right-click to scope' },
];

export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

/** A fresh magazine and reserve for a weapon, as handed out at round start. */
export function newAmmo(weapon) {
  return { mag: weapon.mag, reserve: weapon.reserve };
}

/** Unit direction for a yaw/pitch pair. Yaw 0 faces north (-z); pitch rises positive. */
export function dirFromYawPitch(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/** Damage multiplier for a weapon at a distance: full up close, easing to `min`. */
function falloffMult(weapon, dist) {
  if (!weapon.fall) return 1;
  const { from, to, min } = weapon.fall;
  if (dist <= from) return 1;
  if (dist >= to) return min;
  return 1 - (1 - min) * ((dist - from) / (to - from));
}

/** Ray against one box in 3D; returns the entry distance or Infinity. */
function rayBox(ox, oy, oz, dx, dy, dz, c) {
  let t0 = 0;
  let t1 = Infinity;
  const axes = [
    [ox, dx, c.x0, c.x1],
    [oy, dy, 0, c.h],
    [oz, dz, c.z0, c.z1],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return Infinity;
    } else {
      let ta = (lo - o) / d;
      let tb = (hi - o) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}

const BODY_R = 0.36;
const HEAD_R = 0.25;
const HEAD_Y = 1.58;

/**
 * Trace one hitscan ray. Returns { dist, x, y, z, fighter, head } — the nearest thing
 * hit: a wall box, or an enemy fighter's body cylinder / head sphere. `fighters` are the
 * possible victims (never the shooter); dead fighters are skipped.
 */
export function traceShot(colliders, fighters, ox, oy, oz, dx, dy, dz) {
  let best = Infinity;
  let victim = null;
  let head = false;
  for (const c of colliders) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, c);
    if (t < best) {
      best = t;
      victim = null;
      head = false;
    }
  }
  for (const f of fighters) {
    if (!f.alive) continue;
    // Head sphere: closest distance from its centre to the ray.
    const px = f.pos.x - ox;
    const py = HEAD_Y - oy;
    const pz = f.pos.z - oz;
    const tHead = px * dx + py * dy + pz * dz;
    if (tHead > 0) {
      const cx = ox + dx * tHead - f.pos.x;
      const cy = oy + dy * tHead - HEAD_Y;
      const cz = oz + dz * tHead - f.pos.z;
      if (cx * cx + cy * cy + cz * cz < HEAD_R * HEAD_R && tHead < best) {
        best = tHead;
        victim = f;
        head = true;
        continue;
      }
    }
    // Body cylinder: closest approach in the ground plane, height checked at that t.
    const rx = f.pos.x - ox;
    const rz = f.pos.z - oz;
    const denom = dx * dx + dz * dz;
    if (denom < 1e-9) continue;
    const tBody = (rx * dx + rz * dz) / denom;
    if (tBody <= 0 || tBody >= best) continue;
    const qx = ox + dx * tBody - f.pos.x;
    const qz = oz + dz * tBody - f.pos.z;
    if (qx * qx + qz * qz >= BODY_R * BODY_R) continue;
    const y = oy + dy * tBody;
    if (y < 0.05 || y > 1.74) continue;
    best = tBody;
    victim = f;
    head = false;
  }
  return {
    dist: best,
    x: ox + dx * best,
    y: oy + dy * best,
    z: oz + dz * best,
    fighter: victim,
    head,
  };
}

/** Begin a reload if the magazine is short and the reserve has rounds. */
export function startReload(match, f) {
  const w = WEAPON_BY_ID[f.weaponId];
  if (f.reloading > 0 || f.ammo.mag >= w.mag || f.ammo.reserve <= 0 || !f.alive) return;
  f.reloading = w.reload;
  match.fx.push({ type: 'sound', name: 'reload', by: f.id });
}

/** One trigger pull: spread the pellets, trace each, apply damage, record the show. */
function fireOnce(match, f, weapon) {
  const rng = match.rng;
  const ox = f.pos.x;
  const oy = EYE - 0.06;
  const oz = f.pos.z;
  const enemies = match.fighters.filter((o) => o.team !== f.team);
  const moving = Math.hypot(f.vel.x, f.vel.z) > 0.6;
  const spreadMul = (moving ? 1.8 : 1) * (f.aimSpreadMul ?? 1) * (1 + (f.heat ?? 0));
  f.heat = Math.min(0.8, (f.heat ?? 0) + weapon.bloom);
  f.ammo.mag -= 1;
  match.fx.push({ type: 'muzzle', fighter: f.id });
  match.fx.push({ type: 'sound', name: 'shot', kind: weapon.kind, by: f.id, x: ox, z: oz });
  for (let p = 0; p < weapon.pellets; p += 1) {
    const spread = weapon.spread * spreadMul;
    const yaw = f.yaw + (rng() * 2 - 1) * spread;
    const pitch = f.pitch + (rng() * 2 - 1) * spread;
    const d = dirFromYawPitch(yaw, pitch);
    const hit = traceShot(match.map.colliders, enemies, ox, oy, oz, d.x, d.y, d.z);
    const dist = Math.min(hit.dist, 90);
    match.fx.push({
      type: 'tracer', team: f.team,
      x0: ox + d.x * 0.55, y0: oy - 0.08, z0: oz + d.z * 0.55,
      x1: ox + d.x * dist, y1: oy + d.y * dist, z1: oz + d.z * dist,
    });
    if (hit.fighter) {
      const dmg = weapon.damage * (hit.head ? weapon.headMult : 1) * falloffMult(weapon, hit.dist);
      match.damageFighter(f, hit.fighter, dmg, hit.head);
      match.fx.push({ type: 'impact', x: hit.x, y: hit.y, z: hit.z, flesh: true });
    } else if (hit.dist < Infinity) {
      match.fx.push({ type: 'impact', x: hit.x, y: hit.y, z: hit.z, flesh: false });
    }
  }
}

/**
 * Advance one fighter's weapon by dt: reload timer, fire cooldown, and firing while the
 * fighter's intent holds the trigger. Semi-automatic weapons need a fresh press, which
 * the intent producers supply as an edge (intent.firePressed).
 */
export function stepWeapon(match, f, dt) {
  if (!f.alive) return;
  const weapon = WEAPON_BY_ID[f.weaponId];
  f.heat = Math.max(0, (f.heat ?? 0) - dt * 3);
  if (f.fireCd > 0) f.fireCd -= dt;
  if (f.reloading > 0) {
    f.reloading -= dt;
    if (f.reloading <= 0) {
      const take = Math.min(weapon.mag - f.ammo.mag, f.ammo.reserve);
      f.ammo.mag += take;
      f.ammo.reserve -= take;
      f.reloading = 0;
    }
    return;
  }
  if (f.ammo.mag <= 0) {
    if (f.intent.fire || f.intent.firePressed) {
      if (f.dryCd <= 0) {
        match.fx.push({ type: 'sound', name: 'dry', by: f.id });
        f.dryCd = 0.3;
      }
      startReload(match, f);
    }
    if (f.dryCd > 0) f.dryCd -= dt;
    return;
  }
  const wantsFire = weapon.auto ? f.intent.fire : f.intent.firePressed;
  if (wantsFire && f.fireCd <= 0 && match.phase === 'live') {
    fireOnce(match, f, weapon);
    f.fireCd = 60 / weapon.rpm;
  }
}
