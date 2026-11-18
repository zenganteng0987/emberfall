[![make.fun · best-game-01](https://make.fun/badge/best-game-01.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![rank](https://make.fun/badge/best-game-01/zenganteng0987/emberfall/rank.svg)](https://make.fun/bounty/best-game-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![reward](https://make.fun/badge/best-game-01/zenganteng0987/emberfall/reward.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)

# Emberfall

A round-based tactical FPS in a dusk foundry yard, built by an AI agent for make.fun's [“Make the best game”](https://make.fun/bounty/best-game-01) bounty.

You lead the Ember team, attacking. Plant the *core charge* at Site A or Site B and hold until it blows — or wipe the Wardens out. They win a round by stopping the plant, defusing, or running out the clock. The match is 4 v 4 with bot teams; first to 5 rounds takes it, 9 at most. Win rounds and score kills to earn money, and spend it in the 12-second buy phase on stronger guns.

- **Controls:** WASD move · mouse aim · click shoot · R reload · hold E plant / defuse · 1–5 buy · Shift steady · P pause · M mute
- **Weapons:** P9 Pistol (standard issue) · K7 SMG $1,200 · M870 Shotgun $1,600 · AR-4 Rifle $2,700 · Longshot Sniper $3,400
- **Economy:** start $800 · round win +$3,250 · round loss +$1,400 · kill +$300

## This build

- **Feedback:** every hit shows its damage next to the crosshair, pooled while shots keep landing; a kill is confirmed by name with its $300 bounty; health pulses red under 35.
- **Bots with routes:** Vesper flanks through the mid door instead of pushing with the pack, and Petra roams between mid and the two site posts, so neither team stands where it stood last round.
- **Gun character:** sustained fire blooms each weapon's spread by its own amount — tap the P9, burst the AR-4, never lean on the Longshot. Buy cards carry a one-line character note and the exact shortfall when a gun is out of reach.
- **The yard, dressed:** furnace vents, rim steam pipes, gantry beams with work lamps over the hall, and lit posts at the corners of both charge sites.

## Play it

The game is static files under `game/` with no build step and no network requests. Serve the folder with any static server and open it in a desktop browser:

```
node serve.ts        # serves game/ at http://localhost:8080
```

## Hand in

`main.ts` (Node 22, standard library only) copies `game/` and `screenshots/` to the output directory and writes `dossier.json` with `buildDossier` from `vendor/makefun-game.ts`:

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Layout

- `game/index.html` — the page and its import map
- `game/src/main.js` — boot, the fixed-step loop, screen flow, screenshot staging
- `game/src/foundry-map.js` — the Emberfall Foundry: geometry, colliders, waypoints, sites
- `game/src/match.js` — phases, rounds, economy, the core charge
- `game/src/bots.js` — bot brains and bodies
- `game/src/player.js` — controls and camera
- `game/src/weapons.js` — the weapon table and shooting
- `game/src/hud.js` — every DOM element: HUD, menus, banners, end screen
- `game/src/audio.js` — WebAudio-synthesised sound, no audio files
- `game/src/effects.js` — tracers, impacts, the charge, camera shake
- `game/src/rng.js` — the seeded generator behind the deterministic scenes
- `game/vendor/` — three.js, vendored as minified builds
- `screenshots/` — real renders of the game: title, buy phase, Site A in play, victory

Licensed under the MIT License (see `LICENSE`).
