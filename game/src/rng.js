// rng.js — one job: a small seeded random generator (mulberry32) so a match, and every
// screenshot scene, plays out identically for a given seed. Nothing in the game uses
// Math.random for simulation; presentation code may share this generator too.

/** Create a generator function that returns floats in [0, 1). */
export function createRng(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Float in [min, max) drawn from `rng`. */
export function rngRange(rng, min, max) {
  return min + rng() * (max - min);
}

/** Integer in [min, max] (both ends included) drawn from `rng`. */
export function rngInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/** One element of `list`, chosen by `rng`. */
export function rngPick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

/** True with probability `p`. */
export function rngChance(rng, p) {
  return rng() < p;
}
