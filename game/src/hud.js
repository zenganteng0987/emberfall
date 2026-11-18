// hud.js — one job: everything drawn in DOM. The in-round HUD (health, money, ammo,
// clock, scores, charge status, kill feed, hitmarker, kill confirm, damage dealt,
// damage direction, plant channel bar), the centre banner, and the four screens
// (title, buy menu, match end, pause).
// It reads match state and writes elements; it never changes the simulation. Buttons
// and buy cards call back into main.js through the hooks it is given.

import { WEAPONS, WEAPON_BY_ID } from './weapons.js';
import { PLANT_SECONDS, DEFUSE_SECONDS, TEAM_NAMES, KILL_PAY } from './match.js';

const $ = (id) => document.getElementById(id);

/** Seconds to a m:ss clock face. */
function clockText(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Create the HUD around the page's elements. */
export function createHud(hooks) {
  const el = {
    hud: $('hud'), scoreAtk: $('score-atk'), scoreDef: $('score-def'),
    roundLabel: $('round-label'), timer: $('timer'), charge: $('charge-status'),
    killfeed: $('killfeed'), healthNum: $('health-num'), healthBar: $('health-bar'),
    money: $('money'), weaponName: $('weapon-name'), ammo: $('ammo'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'),
    channelWrap: $('channel-wrap'), channelLabel: $('channel-label'), channelBar: $('channel-bar'),
    eliminated: $('eliminated-note'), hitmarker: $('hitmarker'),
    killConfirm: $('kill-confirm'), damageNum: $('damage-num'),
    vignette: $('damage-vignette'), damageDir: $('damage-dir'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    title: $('title-screen'), buy: $('buy-menu'), buyTimer: $('buy-timer'),
    buyMoney: $('buy-money'), buyGrid: $('buy-grid'),
    end: $('end-screen'), endTitle: $('end-title'), endSub: $('end-sub'),
    endBody: $('end-stats-body'), pause: $('pause-screen'),
    lockPrompt: $('lock-prompt'), toast: $('toast'), status: $('status'),
  };

  $('play-btn').addEventListener('click', () => hooks.onPlay());
  $('again-btn').addEventListener('click', () => hooks.onAgain());
  $('resume-btn').addEventListener('click', () => hooks.onResume());

  let bannerT = 0;
  let hitT = 0;
  let dmgT = 0;
  let toastT = 0;
  let killConfirmT = 0;
  let dmgNumT = 0;
  let dmgAccum = 0;
  const feedRows = [];

  const hud = {
    /** Show one full screen ('title' | 'buy' | 'end' | 'pause') or none of them. */
    showScreen(name) {
      el.title.classList.toggle('hidden', name !== 'title');
      el.buy.classList.toggle('hidden', name !== 'buy');
      el.end.classList.toggle('hidden', name !== 'end');
      el.pause.classList.toggle('hidden', name !== 'pause');
    },
    /** The in-round HUD is visible whenever a match is running. */
    setHudVisible(visible) {
      el.hud.classList.toggle('hidden', !visible);
    },
    setLockPrompt(visible) {
      el.lockPrompt.classList.toggle('hidden', !visible);
    },
    /** A big centre message for a few seconds: round results, plants, warnings. */
    banner(title, sub, cls = '', seconds = 2.6) {
      el.bannerTitle.textContent = title;
      el.bannerTitle.className = cls;
      el.bannerSub.textContent = sub ?? '';
      el.banner.classList.remove('hidden');
      bannerT = seconds;
      el.status.textContent = sub ? `${title}. ${sub}` : title;
    },
    /** One kill feed row: killer, weapon, victim, with team colours. */
    feed(killer, victim, weaponName, head) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      const k = document.createElement('span');
      k.className = killer.team === 'atk' ? 'who-atk' : 'who-def';
      k.textContent = killer.name;
      const gun = document.createElement('span');
      gun.className = 'gun';
      gun.textContent = ` ▸ ${weaponName}${head ? ' (headshot)' : ''} ▸ `;
      const v = document.createElement('span');
      v.className = victim.team === 'atk' ? 'who-atk' : 'who-def';
      v.textContent = victim.name;
      row.append(k, gun, v);
      el.killfeed.append(row);
      feedRows.push({ row, age: 0 });
      while (feedRows.length > 5) {
        const old = feedRows.shift();
        old.row.remove();
      }
    },
    /** Flash the hitmarker; red and longer for a kill. */
    hitmark(kill) {
      el.hitmarker.className = kill ? 'kill on' : 'on';
      hitT = kill ? 0.22 : 0.1;
    },
    /** Confirm a kill the player scored: who fell, and the $300 it paid. */
    killConfirm(victimName, head) {
      el.killConfirm.textContent = head
        ? `HEADSHOT — ${victimName} eliminated · +$${KILL_PAY}`
        : `Eliminated ${victimName} · +$${KILL_PAY}`;
      el.killConfirm.classList.remove('hidden');
      killConfirmT = 1.15;
    },
    /** Show the damage the player's shots just dealt, pooled while they keep landing. */
    damageDealt(amount) {
      if (!(amount > 0)) return;
      dmgAccum += amount;
      el.damageNum.textContent = `−${Math.round(dmgAccum)}`;
      el.damageNum.classList.remove('hidden');
      dmgNumT = 0.55;
    },
    /** Show the damage vignette and the arc toward whoever shot the player. */
    damageFrom(relAngle) {
      el.vignette.classList.add('on');
      el.damageDir.style.transform = `rotate(${relAngle}rad)`;
      el.damageDir.classList.add('on');
      dmgT = 0.45;
    },
    /** Hide the centre banner at once (screenshot staging: banners never age there). */
    clearBanner() {
      bannerT = 0;
      el.banner.classList.add('hidden');
    },
    /** Blank the charge status line (screenshot staging for the buy screen). */
    clearCharge() {
      el.charge.textContent = '';
    },
    /** A small centred note that fades (mute toggles, denials). */
    toast(message, seconds = 1.6) {
      el.toast.textContent = message;
      el.toast.classList.remove('hidden');
      toastT = seconds;
    },
    /** Rebuild the buy cards for the player's purse and current weapon. */
    refreshBuy(match) {
      const player = match.fighters[0];
      el.buyMoney.textContent = `$${player.money}`;
      el.buyGrid.replaceChildren();
      WEAPONS.forEach((w, i) => {
        const owned = player.weaponId === w.id;
        const cant = !owned && player.money < w.price;
        const card = document.createElement('div');
        card.className = `buy-card${owned ? ' owned' : ''}${cant ? ' cant' : ''}`;
        const dmg = w.pellets > 1 ? `${w.damage}×${w.pellets}` : `${w.damage}`;
        card.innerHTML = '';
        const key = document.createElement('div');
        key.className = 'key';
        key.textContent = `KEY ${i + 1}`;
        const name = document.createElement('div');
        name.className = 'wname';
        name.textContent = w.name;
        const price = document.createElement('div');
        price.className = 'price';
        price.textContent = w.price === 0 ? 'Standard issue' : `$${w.price}`;
        const stat = document.createElement('div');
        stat.className = 'stat';
        stat.textContent = `Damage ${dmg} · ${w.rpm} rpm · ${w.mag} rounds`;
        const blurb = document.createElement('div');
        blurb.className = 'blurb';
        blurb.textContent = w.blurb;
        card.append(key, name, price, stat, blurb);
        if (owned) {
          const tag = document.createElement('div');
          tag.className = 'owned-tag';
          tag.textContent = 'IN HAND';
          card.append(tag);
        }
        if (cant) {
          const short = document.createElement('div');
          short.className = 'shortfall';
          short.textContent = `Need $${w.price - player.money} more`;
          card.append(short);
        }
        if (!cant && !owned) card.addEventListener('click', () => hooks.onBuy(w.id));
        el.buyGrid.append(card);
      });
    },
    /** Fill and show the match end screen: result, final score, the full table. */
    showEnd(match) {
      const playerWon = match.winner === 'atk';
      el.endTitle.textContent = playerWon ? 'Victory' : 'Defeat';
      el.endTitle.className = match.winner;
      el.endSub.textContent = `${TEAM_NAMES.atk} ${match.wins.atk} — ${match.wins.def} ${TEAM_NAMES.def} · ${match.round} rounds played`;
      el.endBody.replaceChildren();
      const rows = [...match.fighters].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      for (const f of rows) {
        const tr = document.createElement('tr');
        if (f.isPlayer) tr.className = 'me';
        const cells = [f.name, TEAM_NAMES[f.team], String(f.kills), String(f.deaths)];
        cells.forEach((text, i) => {
          const td = document.createElement('td');
          if (i >= 2) td.className = 'num';
          td.textContent = text;
          tr.append(td);
        });
        el.endBody.append(tr);
      }
      hud.showScreen('end');
    },
    /** Per-frame refresh of every live value, straight from the match state. */
    update(match) {
      const player = match.fighters[0];
      el.scoreAtk.textContent = String(match.wins.atk);
      el.scoreDef.textContent = String(match.wins.def);
      el.roundLabel.textContent = `Round ${match.round}`;
      const charge = match.charge;
      if (match.phase === 'buy') {
        el.timer.textContent = clockText(match.phaseT);
        el.timer.classList.remove('low');
        el.buyTimer.textContent = String(Math.max(0, Math.ceil(match.phaseT)));
      } else if (charge.state === 'planted') {
        el.timer.textContent = clockText(charge.fuse);
        el.timer.classList.toggle('low', charge.fuse < 10);
      } else {
        el.timer.textContent = clockText(match.phaseT);
        el.timer.classList.toggle('low', match.phase === 'live' && match.phaseT < 15);
      }
      el.charge.textContent = chargeText(match);
      el.healthNum.textContent = String(Math.max(0, Math.ceil(player.hp)));
      el.healthNum.classList.toggle('low', player.alive && player.hp <= 35);
      el.healthBar.style.width = `${Math.max(0, player.hp)}%`;
      el.money.textContent = `$${player.money}`;
      const w = WEAPON_BY_ID[player.weaponId];
      el.weaponName.textContent = player.reloading > 0 ? `${w.name} — reloading` : w.name;
      el.ammoMag.textContent = String(player.ammo.mag);
      el.ammoReserve.textContent = ` / ${player.ammo.reserve}`;
      el.ammo.classList.toggle('low', player.ammo.mag <= 3 && player.reloading <= 0);
      el.eliminated.classList.toggle('hidden', player.alive || match.phase !== 'live');
      if (player.channelKind === 'plant') {
        el.channelWrap.classList.remove('hidden');
        el.channelLabel.textContent = 'Planting the core charge…';
        el.channelBar.style.width = `${Math.min(100, (player.channelT / PLANT_SECONDS) * 100)}%`;
      } else if (player.channelKind === 'defuse') {
        el.channelWrap.classList.remove('hidden');
        el.channelLabel.textContent = 'Defusing the core charge…';
        el.channelBar.style.width = `${Math.min(100, (player.channelT / DEFUSE_SECONDS) * 100)}%`;
      } else {
        el.channelWrap.classList.add('hidden');
      }
    },
    /** Age the transient elements (banner, hitmarker, damage arc, feed, toast). */
    tick(dt) {
      if (bannerT > 0) {
        bannerT -= dt;
        if (bannerT <= 0) el.banner.classList.add('hidden');
      }
      if (hitT > 0) {
        hitT -= dt;
        if (hitT <= 0) el.hitmarker.className = '';
      }
      if (dmgT > 0) {
        dmgT -= dt;
        if (dmgT <= 0) {
          el.vignette.classList.remove('on');
          el.damageDir.classList.remove('on');
        }
      }
      if (toastT > 0) {
        toastT -= dt;
        if (toastT <= 0) el.toast.classList.add('hidden');
      }
      if (killConfirmT > 0) {
        killConfirmT -= dt;
        if (killConfirmT <= 0) el.killConfirm.classList.add('hidden');
      }
      if (dmgNumT > 0) {
        dmgNumT -= dt;
        if (dmgNumT <= 0) {
          el.damageNum.classList.add('hidden');
          dmgAccum = 0;
        }
      }
      for (let i = feedRows.length - 1; i >= 0; i -= 1) {
        feedRows[i].age += dt;
        if (feedRows[i].age > 5.5) {
          feedRows[i].row.remove();
          feedRows.splice(i, 1);
        }
      }
    },
  };

  /** The one-line charge status shown under the clock. */
  function chargeText(match) {
    const charge = match.charge;
    if (match.phase === 'buy') {
      const carrier = match.fighters[charge.carrierId];
      if (!carrier) return 'Buy phase';
      return carrier.isPlayer
        ? `You carry the core charge — plant it at Site ${match.targetSite} or the other site`
        : `${carrier.name} carries the core charge`;
    }
    if (match.phase !== 'live') return '';
    if (charge.state === 'carried') {
      const carrier = match.fighters[charge.carrierId];
      return carrier && carrier.isPlayer
        ? 'You carry the core charge — hold E inside a site pad to plant'
        : `${carrier ? carrier.name : 'An ally'} carries the core charge`;
    }
    if (charge.state === 'dropped') return 'The core charge is down — recover it';
    if (charge.state === 'planted') return `CHARGE PLANTED — Site ${charge.site}`;
    return '';
  }

  return hud;
}
