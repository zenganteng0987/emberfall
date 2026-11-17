// effects.js — one job: the visible sparks of a fight. Tracer lines that fade in a
// blink, impact sparks (grey off walls, ember off fighters), muzzle flashes, the core
// charge's little mesh and its planted blink, the detonation fireball, and the camera
// trauma that main.js turns into shake. Everything is pooled and purely presentational:
// effects never touch the simulation, and their randomness comes from the seeded rng.

import * as THREE from 'three';
import { EYE } from './foundry-map.js';

const TRACER_POOL = 28;
const SPARK_COUNT = 320;

/** Create the effects rig inside the scene. */
export function createEffects(scene, rng) {
  // Tracers: one reusable line per recent shot, coloured by the shooter's team.
  const tracers = [];
  const tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  for (let i = 0; i < TRACER_POOL; i += 1) {
    const mat = new THREE.LineBasicMaterial({ color: 0xffc37a, transparent: true, opacity: 0 });
    const line = new THREE.Line(tracerGeo.clone(), mat);
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerI = 0;

  // Sparks: a single Points cloud whose particles live, fall and die.
  const sparkPos = new Float32Array(SPARK_COUNT * 3);
  const sparkVel = new Float32Array(SPARK_COUNT * 3);
  const sparkLife = new Float32Array(SPARK_COUNT);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    color: 0xffb066, size: 0.09, transparent: true, opacity: 0.95, depthWrite: false,
  }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  let sparkI = 0;
  for (let i = 0; i < SPARK_COUNT; i += 1) sparkPos[i * 3 + 1] = -50;

  // One shared flash light for muzzles and the blast.
  const flash = new THREE.PointLight(0xffa04d, 0, 13, 1.8);
  scene.add(flash);
  let flashLife = 0;

  // The detonation fireball.
  const fireball = new THREE.Mesh(
    new THREE.SphereGeometry(1, 18, 14),
    new THREE.MeshBasicMaterial({ color: 0xffa63d, transparent: true, opacity: 0 }),
  );
  fireball.visible = false;
  scene.add(fireball);
  let fireLife = 0;

  // The core charge: a small ember box with a light, carried, dropped or planted.
  const chargeGroup = new THREE.Group();
  const chargeBox = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.22, 0.24),
    new THREE.MeshLambertMaterial({ color: 0x3a3f45 }),
  );
  chargeBox.position.y = 0.11;
  chargeGroup.add(chargeBox);
  const chargeCore = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.1, 0.14),
    new THREE.MeshBasicMaterial({ color: 0xff7a26 }),
  );
  chargeCore.position.y = 0.24;
  chargeGroup.add(chargeCore);
  const chargeLight = new THREE.PointLight(0xff7a26, 6, 6, 1.8);
  chargeLight.position.y = 0.5;
  chargeGroup.add(chargeLight);
  scene.add(chargeGroup);

  let trauma = 0;
  let elapsed = 0;

  /** Spawn a handful of sparks at a point. */
  function burst(x, y, z, n, color) {
    sparks.material.color.setHex(color);
    for (let k = 0; k < n; k += 1) {
      const i = sparkI;
      sparkI = (sparkI + 1) % SPARK_COUNT;
      sparkPos[i * 3] = x;
      sparkPos[i * 3 + 1] = y;
      sparkPos[i * 3 + 2] = z;
      sparkVel[i * 3] = (rng() * 2 - 1) * 2.4;
      sparkVel[i * 3 + 1] = rng() * 2.6 + 0.4;
      sparkVel[i * 3 + 2] = (rng() * 2 - 1) * 2.4;
      sparkLife[i] = 0.35 + rng() * 0.3;
    }
  }

  return {
    /** A tracer from muzzle to impact, gone in a blink. */
    tracer(x0, y0, z0, x1, y1, z1, team) {
      const t = tracers[tracerI];
      tracerI = (tracerI + 1) % TRACER_POOL;
      const attr = t.line.geometry.getAttribute('position');
      attr.setXYZ(0, x0, y0, z0);
      attr.setXYZ(1, x1, y1, z1);
      attr.needsUpdate = true;
      t.line.material.color.setHex(team === 'atk' ? 0xffc37a : 0x7ae8dc);
      t.line.material.opacity = 0.85;
      t.line.visible = true;
      t.life = 0.055;
    },
    /** Sparks where a pellet landed: grey dust off scenery, ember off a fighter. */
    impact(x, y, z, flesh) {
      burst(x, y, z, flesh ? 7 : 5, flesh ? 0xff8a50 : 0xcfd4d8);
    },
    /** A flash of light at a firing fighter's gun. */
    muzzle(fighter) {
      flash.position.set(fighter.pos.x, EYE - 0.1, fighter.pos.z);
      flash.intensity = 26;
      flashLife = 0.045;
    },
    /** The charge detonates: fireball, spark storm, light and a hard shake. */
    explosion(x, z) {
      fireball.position.set(x, 1.1, z);
      fireball.visible = true;
      fireLife = 0.55;
      burst(x, 1, z, 70, 0xffa63d);
      burst(x, 1.6, z, 30, 0xffe2a8);
      flash.position.set(x, 1.6, z);
      flash.intensity = 320;
      flashLife = 0.3;
      trauma = Math.min(1, trauma + 0.75);
    },
    /** Add camera trauma (0..1); shake falls off with its square, so small hits are gentle. */
    addShake(amount) {
      trauma = Math.min(1, trauma + amount);
    },
    /** The current shake offset for the camera, from two cheap sine wobbles. */
    shakeOffset() {
      const s = trauma * trauma;
      return {
        x: Math.sin(elapsed * 61) * 0.05 * s,
        y: Math.cos(elapsed * 53) * 0.045 * s,
        roll: Math.sin(elapsed * 47) * 0.012 * s,
      };
    },
    /** Keep the charge mesh with its carrier, on the ground, or blinking on its site. */
    syncCharge(match, dt) {
      const charge = match.charge;
      if (charge.state === 'carried') {
        const carrier = match.fighters[charge.carrierId];
        chargeGroup.position.set(carrier.pos.x, 1.95 + Math.sin(elapsed * 3) * 0.05, carrier.pos.z);
        chargeLight.intensity = 6;
        chargeGroup.visible = true;
      } else if (charge.state === 'dropped') {
        chargeGroup.position.set(charge.x, 0, charge.z);
        chargeLight.intensity = 3 + Math.sin(elapsed * 5) * 2;
        chargeGroup.visible = true;
      } else if (charge.state === 'planted') {
        chargeGroup.position.set(charge.x, 0, charge.z);
        const urgent = charge.fuse < 10 ? 14 : 6;
        chargeLight.intensity = (Math.sin(elapsed * urgent) > 0 ? 16 : 2);
        chargeGroup.visible = true;
      } else {
        chargeGroup.visible = false;
      }
      chargeGroup.rotation.y += dt * 0.8;
    },
    /** Advance every visual by the frame's real dt. */
    update(dt) {
      elapsed += dt;
      trauma = Math.max(0, trauma - dt * 1.7);
      for (const t of tracers) {
        if (t.life > 0) {
          t.life -= dt;
          t.line.material.opacity = Math.max(0, t.life / 0.055) * 0.85;
          if (t.life <= 0) t.line.visible = false;
        }
      }
      for (let i = 0; i < SPARK_COUNT; i += 1) {
        if (sparkLife[i] <= 0) continue;
        sparkLife[i] -= dt;
        if (sparkLife[i] <= 0) {
          sparkPos[i * 3 + 1] = -50;
          continue;
        }
        sparkVel[i * 3 + 1] -= 6.5 * dt;
        sparkPos[i * 3] += sparkVel[i * 3] * dt;
        sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
        sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
        if (sparkPos[i * 3 + 1] < 0.02) sparkPos[i * 3 + 1] = 0.02;
      }
      sparkGeo.getAttribute('position').needsUpdate = true;
      if (flashLife > 0) {
        flashLife -= dt;
        if (flashLife <= 0) flash.intensity = 0;
      }
      if (fireLife > 0) {
        fireLife -= dt;
        const k = 1 - Math.max(0, fireLife) / 0.55;
        fireball.scale.setScalar(1 + k * 9);
        fireball.material.opacity = 0.85 * (1 - k);
        if (fireLife <= 0) fireball.visible = false;
      }
    },
  };
}
