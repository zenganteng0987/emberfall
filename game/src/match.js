// match.js — one job: the match itself. It owns the eight fighters, the phases (buy,
// live, round end, match end), the round clock and the charge fuse, the economy, the
// core charge (carried, dropped, planted, defused, detonated) and every win check.
// Fighters never act on their own here: the player and the bots fill each fighter's
// `intent` (move direction, look angles, trigger, channel) and this module steps the
// world at a fixed 1/60 s. Presentation reads `events` (things that happened) and
// `fx` (things to show or play) and empties both every frame.

import { collideCircle, EYE } from './foundry-map.js';
import { WEAPON_BY_ID, newAmmo, stepWeapon } from './weapons.js';
import { rngPick } from './rng.js';

export const BUY_SECONDS = 12;
export const ROUND_SECONDS = 100;
export const FUSE_SECONDS = 40;
export const PLANT_SECONDS = 3.2;
export const DEFUSE_SECONDS = 5;
export const ROUND_END_SECONDS = 4.5;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;
export const START_MONEY = 800;
export const WIN_PAY = 3250;
export const LOSS_PAY = 1400;
export const KILL_PAY = 300;
export const WALK_SPEED = 4.3;
export const FIGHTER_RADIUS = 0.38;

const ATK_BOTS = ['Sable', 'Rook', 'Vesper'];
const DEF_BOTS = ['Hollis', 'Marlowe', 'Ilya', 'Petra'];
export const TEAM_NAMES = { atk: 'Ember', def: 'Wardens' };

/** A fresh fighter record. The player is fighter 0, on the attacking Ember team. */
function makeFighter(id, name, team, isPlayer) {
  return {
    id, name, team, isPlayer,
    pos: { x: 0, z: 0 }, vel: { x: 0, z: 0 },
    yaw: 0, pitch: 0, hp: 100, alive: true, god: false,
    weaponId: 'p9', ammo: newAmmo(WEAPON_BY_ID.p9),
    fireCd: 0, reloading: 0, dryCd: 0, aimSpreadMul: 1,
    money: START_MONEY, kills: 0, deaths: 0,
    channelT: 0, channelKind: null,
    intent: { mx: 0, mz: 0, fire: false, firePressed: false, channel: false },
  };
}

/** Create the whole match state around the map data and the shared seeded rng. */
export function createMatch(map, rng) {
  const fighters = [makeFighter(0, 'You', 'atk', true)];
  ATK_BOTS.forEach((name, i) => fighters.push(makeFighter(i + 1, name, 'atk', false)));
  DEF_BOTS.forEach((name, i) => fighters.push(makeFighter(i + 4, name, 'def', false)));

  const match = {
    map, rng, fighters,
    phase: 'title', phaseT: 0, round: 0,
    wins: { atk: 0, def: 0 },
    targetSite: 'A',
    charge: { state: 'held', carrierId: -1, x: 0, z: 0, site: null, fuse: 0 },
    events: [], fx: [],
    winner: null, lastRound: null,
  };

  /** The living members of a team. */
  match.aliveOf = (team) => fighters.filter((f) => f.team === team && f.alive);

  /** Put every fighter on its spawn point, alive, at full health, charge in hand. */
  match.placeAtSpawns = () => {
    for (const f of fighters) {
      const spawn = map.spawns[f.team][f.id % 4];
      f.pos.x = spawn.x;
      f.pos.z = spawn.z;
      f.vel.x = 0;
      f.vel.z = 0;
      f.yaw = spawn.yaw;
      f.pitch = 0;
      f.hp = 100;
      f.alive = true;
      f.fireCd = 0;
      f.reloading = 0;
      f.channelT = 0;
      f.channelKind = null;
      f.intent.fire = false;
      f.intent.firePressed = false;
      f.intent.channel = false;
      f.intent.mx = 0;
      f.intent.mz = 0;
      f.ammo = newAmmo(WEAPON_BY_ID[f.weaponId]);
    }
  };

  /** A new match: money, scores and statistics back to the start, then round 1. */
  match.startMatch = () => {
    match.wins.atk = 0;
    match.wins.def = 0;
    match.round = 0;
    match.winner = null;
    for (const f of fighters) {
      f.money = START_MONEY;
      f.kills = 0;
      f.deaths = 0;
      f.weaponId = 'p9';
    }
    match.startRound();
  };

  /** Begin a round: spawns, a random carrier on Ember, a planned site, buy phase. */
  match.startRound = () => {
    match.round += 1;
    for (const f of fighters) {
      if (!f.aliveAtRoundEnd) f.weaponId = 'p9';
    }
    match.placeAtSpawns();
    for (const f of fighters) f.aliveAtRoundEnd = true;
    const attackers = fighters.filter((f) => f.team === 'atk');
    const carrier = rngPick(rng, attackers);
    match.charge = { state: 'carried', carrierId: carrier.id, x: carrier.pos.x, z: carrier.pos.z, site: null, fuse: 0 };
    match.targetSite = rng() < 0.5 ? 'A' : 'B';
    match.phase = 'buy';
    match.phaseT = BUY_SECONDS;
    match.events.push({ type: 'roundStart', round: match.round, carrierId: carrier.id, targetSite: match.targetSite });
  };

  /** Buy a weapon for a fighter during the buy phase; true when the sale happened. */
  match.buyWeapon = (f, weaponId) => {
    const w = WEAPON_BY_ID[weaponId];
    if (!w || match.phase !== 'buy' || !f.alive) return false;
    if (f.weaponId === weaponId || f.money < w.price) return false;
    f.money -= w.price;
    f.weaponId = weaponId;
    f.ammo = newAmmo(w);
    f.reloading = 0;
    match.fx.push({ type: 'sound', name: 'buy', by: f.id });
    return true;
  };

  /** Damage one fighter; handles death, kill pay, kill feed and dropping the charge. */
  match.damageFighter = (src, dst, dmg, head) => {
    if (!dst.alive || dst.god || match.phase !== 'live') return;
    dst.hp -= dmg;
    match.events.push({ type: 'hit', srcId: src.id, dstId: dst.id, head: !!head });
    if (dst.hp > 0) return;
    dst.hp = 0;
    dst.alive = false;
    dst.aliveAtRoundEnd = false;
    dst.deaths += 1;
    src.kills += 1;
    src.money += KILL_PAY;
    dst.channelT = 0;
    dst.channelKind = null;
    match.events.push({ type: 'kill', srcId: src.id, dstId: dst.id, weaponId: src.weaponId, head: !!head });
    if (match.charge.state === 'carried' && match.charge.carrierId === dst.id) {
      match.charge.state = 'dropped';
      match.charge.carrierId = -1;
      match.charge.x = dst.pos.x;
      match.charge.z = dst.pos.z;
      match.events.push({ type: 'chargeDropped', x: dst.pos.x, z: dst.pos.z });
    }
  };

  /** Close the round: pay both teams, remember the result, show the banner phase. */
  function endRound(winner, reason) {
    match.wins[winner] += 1;
    const loser = winner === 'atk' ? 'def' : 'atk';
    for (const f of fighters) f.money += f.team === winner ? WIN_PAY : LOSS_PAY;
    for (const f of fighters) f.aliveAtRoundEnd = f.alive;
    match.lastRound = { winner, reason, round: match.round };
    match.phase = 'roundEnd';
    match.phaseT = ROUND_END_SECONDS;
    match.events.push({ type: 'roundEnd', winner, reason, round: match.round });
  }

  /** The win checks that run once per step while the round is live. */
  function checkRoundEnd() {
    if (match.phase !== 'live') return;
    const defAlive = match.aliveOf('def').length;
    const atkAlive = match.aliveOf('atk').length;
    if (defAlive === 0) endRound('atk', 'elimination');
    else if (atkAlive === 0 && match.charge.state !== 'planted') endRound('def', 'elimination');
  }

  /** Planting: the carrier stands in a site pad and holds the channel for 3.2 s. */
  function stepPlant(f, dt) {
    const site = Object.values(match.map.sites).find(
      (s) => Math.hypot(f.pos.x - s.x, f.pos.z - s.z) <= s.r,
    );
    if (!site || !f.intent.channel) {
      f.channelT = 0;
      f.channelKind = null;
      return;
    }
    f.channelKind = 'plant';
    f.channelT += dt;
    if (Math.floor(f.channelT / 0.8) > Math.floor((f.channelT - dt) / 0.8)) {
      match.fx.push({ type: 'sound', name: 'beep', by: f.id, final: false });
    }
    if (f.channelT >= PLANT_SECONDS) {
      match.charge.state = 'planted';
      match.charge.site = site.id;
      match.charge.x = f.pos.x;
      match.charge.z = f.pos.z;
      match.charge.fuse = FUSE_SECONDS;
      f.channelT = 0;
      f.channelKind = null;
      match.fx.push({ type: 'sound', name: 'beep', by: f.id, final: true });
      match.events.push({ type: 'planted', site: site.id, byId: f.id });
    }
  }

  /** Defusing: a Warden beside the planted charge holds the channel for 5 s. */
  function stepDefuse(f, dt) {
    const near = Math.hypot(f.pos.x - match.charge.x, f.pos.z - match.charge.z) <= 1.7;
    if (!near || !f.intent.channel) {
      f.channelT = 0;
      f.channelKind = null;
      return;
    }
    f.channelKind = 'defuse';
    f.channelT += dt;
    if (f.channelT >= DEFUSE_SECONDS) {
      f.channelT = 0;
      f.channelKind = null;
      match.charge.state = 'gone';
      match.fx.push({ type: 'sound', name: 'defused', by: f.id });
      match.events.push({ type: 'defused', byId: f.id });
      endRound('def', 'defused');
    }
  }

  /** Move one fighter by its intent and keep it out of the furniture. */
  function stepMovement(f, dt) {
    const w = WEAPON_BY_ID[f.weaponId];
    const speed = WALK_SPEED * w.move;
    let mx = f.intent.mx;
    let mz = f.intent.mz;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const channelling = f.channelT > 0 || (f.intent.channel && f.channelKind !== null);
    const effSpeed = channelling ? 0 : speed;
    f.vel.x = mx * effSpeed;
    f.vel.z = mz * effSpeed;
    f.pos.x += f.vel.x * dt;
    f.pos.z += f.vel.z * dt;
    collideCircle(match.map.colliders, f.pos, FIGHTER_RADIUS);
    // Fighters are not furniture, but they may not stand inside each other either.
    for (const o of fighters) {
      if (o === f || !o.alive) continue;
      const dx = f.pos.x - o.pos.x;
      const dz = f.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      const min = FIGHTER_RADIUS * 2;
      if (d2 > 1e-6 && d2 < min * min) {
        const d = Math.sqrt(d2);
        f.pos.x = o.pos.x + (dx / d) * min;
        f.pos.z = o.pos.z + (dz / d) * min;
      }
    }
  }

  /** The fixed-step simulation. `dt` is always 1/60 from the caller. */
  match.step = (dt) => {
    if (match.phase === 'buy' || match.phase === 'live') {
      for (const f of fighters) {
        if (!f.alive) continue;
        stepMovement(f, dt);
        stepWeapon(match, f, dt);
        f.intent.firePressed = false;
      }
      if (match.phase === 'buy') {
        match.phaseT -= dt;
        if (match.phaseT <= 0) {
          match.phase = 'live';
          match.phaseT = ROUND_SECONDS;
          match.events.push({ type: 'live' });
        }
      } else {
        // Live: the charge can be picked up, planted, defused; the clocks run.
        const charge = match.charge;
        if (charge.state === 'carried') {
          const carrier = fighters[charge.carrierId];
          charge.x = carrier.pos.x;
          charge.z = carrier.pos.z;
          if (carrier.alive) stepPlant(carrier, dt);
        } else if (charge.state === 'dropped') {
          for (const f of fighters) {
            if (f.team === 'atk' && f.alive && Math.hypot(f.pos.x - charge.x, f.pos.z - charge.z) < 1.1) {
              charge.state = 'carried';
              charge.carrierId = f.id;
              match.events.push({ type: 'chargePickup', byId: f.id });
              break;
            }
          }
        } else if (charge.state === 'planted') {
          charge.fuse -= dt;
          for (const f of fighters) {
            if (f.team === 'def' && f.alive) stepDefuse(f, dt);
            if (match.phase !== 'live') break;
          }
          if (match.phase === 'live' && charge.fuse <= 0) {
            match.fx.push({ type: 'explosion', x: charge.x, z: charge.z });
            match.events.push({ type: 'detonated', site: charge.site });
            endRound('atk', 'detonation');
          }
        }
        if (match.phase === 'live' && charge.state !== 'planted') {
          match.phaseT -= dt;
          if (match.phaseT <= 0) endRound('def', 'time');
        }
        checkRoundEnd();
      }
    } else if (match.phase === 'roundEnd') {
      match.phaseT -= dt;
      if (match.phaseT <= 0) {
        if (match.wins.atk >= WIN_ROUNDS || match.wins.def >= WIN_ROUNDS || match.round >= MAX_ROUNDS) {
          match.phase = 'matchEnd';
          match.winner = match.wins.atk > match.wins.def ? 'atk' : 'def';
          match.events.push({ type: 'matchEnd', winner: match.winner });
        } else {
          match.startRound();
        }
      }
    }
    return match;
  };

  /** Staging helper for screenshots: jump straight into a live round, rifles out. */
  match.forceLive = () => {
    if (match.phase === 'buy') {
      match.phase = 'live';
      match.phaseT = ROUND_SECONDS;
    }
  };

  /** Staging helper for screenshots: place the fighters as the title screen shows them. */
  match.stageTitle = () => {
    match.placeAtSpawns();
    match.phase = 'title';
  };

  /** Staging helper for screenshots: declare the match over at a given score. */
  match.stageMatchEnd = (atkWins, defWins) => {
    match.wins.atk = atkWins;
    match.wins.def = defWins;
    match.winner = atkWins > defWins ? 'atk' : 'def';
    match.lastRound = { winner: match.winner, reason: 'elimination', round: match.round };
    match.phase = 'matchEnd';
  };

  match.placeAtSpawns();
  return match;
}

export { EYE };
