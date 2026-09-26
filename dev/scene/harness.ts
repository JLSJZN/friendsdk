// Dev-only harness for the Rare Breeds renderer (nursery scene + hatch overlay).
// URL flags: babies=N, tier=common|spotted|mutant|prismatic, reduced=1, fake=1, clean=1, eggs=N, w=<frame css width>,
// chrome=1 (phone UI stand-ins over the world, to judge the camera band),
// hats=1 (accessories on the Friend and babies; stub pixels until the real art exists), hat=<accessory id> (the Friend's),
// hearts=1 (heart income like the game: tier rates, 10 s cycle, staggered) or hearts=fast (3 s cycle)
import wild from "../../games/rare-breeds/data/wild-friends.json";
import { breed, breedSeed } from "../../games/rare-breeds/src/genetics.ts";
import { createHatchSequence } from "../../games/rare-breeds/src/scene/hatch.ts";
import { createNurseryScene } from "../../games/rare-breeds/src/scene/nursery.ts";
import { creatureFromRecord, type WildFriendRecord } from "../../games/rare-breeds/src/sprites.ts";
import { HEART_CYCLE_SECONDS, HEART_RATE } from "../../games/rare-breeds/src/hearts.ts";
import { TIER_ORDER, type AccessoryId, type Creature, type TierId } from "../../games/rare-breeds/src/types.ts";
import type { HatchSequence } from "../../games/rare-breeds/src/api.ts";
import { fakeBaby } from "./fake.ts";

const params = new URLSearchParams(location.search);
const records = (wild as { friends: WildFriendRecord[] }).friends;
const hats = params.get("hats") === "1";
(globalThis as { __stubHats?: boolean }).__stubHats = hats;
const BABY_HATS: AccessoryId[] = ["party-hat", "crown", "halo", "bow", "beanie", "flower", "headphones"];
const wear = (creature: Creature, accessory: AccessoryId | undefined): Creature => Object.freeze({ ...creature, accessory });
let player = creatureFromRecord(records[0], "friend");
if (hats || params.get("hat")) player = wear(player, (params.get("hat") as AccessoryId) || "top-hat");
const pool = records.slice(1).map(record => creatureFromRecord(record));
const useFake = params.get("fake") === "1";
let reducedMotion = params.get("reduced") === "1";
const log: string[] = [];
const frame = document.getElementById("frame") as HTMLDivElement;
if (params.get("w")) frame.style.width = `${Number(params.get("w"))}px`;
if (params.get("clean") === "1") document.body.classList.add("clean");
if (params.get("chrome") === "1") for (const kind of ["hud", "bar", "tools"]) {
  const node = document.createElement("div");
  node.className = `chrome ${kind}`;
  frame.append(node);
}

function makeBaby(a: Creature, b: Creature, playId: number, tier: TierId): Creature {
  if (useFake) return fakeBaby(a, b, playId, tier);
  const id = BigInt(playId);
  const result = breed({ a, b, tier, playId: id, seed: breedSeed(player.tokenId!, a.key, b.key, id) });
  return Object.freeze({
    key: `baby:${playId}`, kind: "baby", name: result.name, family: result.family, familyId: result.familyId,
    lineage: result.lineage, sheet: result.sheet, tier, parents: [a.key, b.key] as const, dna: result.dna, playId: id,
  });
}

let nextPlay = 1;
const tiers: TierId[] = ["spotted", "prismatic", "common", "mutant", "spotted", "mutant"];
const count = Number(params.get("babies") ?? 3);
let brood: Creature[] = Array.from({ length: count }, (_, i) => makeBaby(player, pool[(i * 7 + 3) % pool.length], nextPlay++, tiers[i % tiers.length]));
if (hats) brood = brood.map((baby, i) => wear(baby, BABY_HATS[i % BABY_HATS.length]));

const world = document.getElementById("world") as HTMLCanvasElement;
const scene = createNurseryScene({
  canvas: world, player, reducedMotion,
  onStationNear: station => { log.push(`near:${station}`); status(); },
  onStationActivate: station => { log.push(`activate:${station}`); status(); },
  onCreatureActivate: key => { log.push(`creature:${key}`); status(); },
});
scene.setBrood(brood);
let eggs = Number(params.get("eggs") ?? 2);
scene.setEggCount(eggs);

let hatch: HatchSequence | null = null;
const overlay = document.getElementById("overlay") as HTMLCanvasElement;
function startHatch(tier: TierId = (params.get("tier") as TierId) || "prismatic", mateIndex = 11) {
  hatch?.destroy();
  const fresh = overlay.cloneNode() as HTMLCanvasElement;
  overlay.replaceWith(fresh);
  fresh.id = "overlay";
  fresh.hidden = false;
  const mate = pool[mateIndex % pool.length];
  const baby = makeBaby(player, mate, nextPlay++, tier);
  scene.setPaused(true);
  hatch = createHatchSequence({ canvas: fresh, parentA: player, parentB: mate, baby, reducedMotion, onBeat: beat => { log.push(`beat:${beat}`); status(); } });
  const started = performance.now();
  return hatch.play().then(() => { log.push(`hatch:done:${Math.round(performance.now() - started)}`); status(); return baby; });
}
function closeHatch() {
  hatch?.destroy(); hatch = null;
  (document.getElementById("overlay") as HTMLCanvasElement).hidden = true;
  scene.setPaused(false);
}

// Heart income, as src/hearts.ts schedules it: each baby earns its tier rate once per cycle, at its own second.
const cycle = params.get("hearts") === "fast" ? 3 : HEART_CYCLE_SECONDS;
const phase = (key: string) => { let hash = 0; for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0; return hash % cycle; };
let second = 0, earned = 0;
if (params.get("hearts")) setInterval(() => {
  const now = second++ % cycle;
  for (const baby of brood) if (phase(baby.key) === now) {
    const amount = HEART_RATE[baby.tier ?? "common"];
    earned += amount;
    scene.emitHearts(baby.key, amount);
    log.push(`hearts:${baby.key}:+${amount}`);
  }
}, 1000);

const api = {
  scene, log, player, pool,
  earned: () => earned,
  emit: (key: string, amount: number) => scene.emitHearts(key, amount),
  /** Put an accessory on a baby (same key, new object) or on the Friend (key "player"). */
  dress: (key: string, accessory: AccessoryId | null) => {
    if (key === "player") { player = wear(player, accessory ?? undefined); scene.setPlayer(player); return; }
    brood = brood.map(baby => baby.key === key ? wear(baby, accessory ?? undefined) : baby);
    scene.setBrood(brood);
  },
  brood: () => brood,
  courtship: (index = 5) => { const started = performance.now(); return scene.playCourtship(pool[index % pool.length]).then(() => { log.push(`courtship:done:${Math.round(performance.now() - started)}`); status(); }); },
  release: (key = brood[0]?.key) => {
    const started = performance.now();
    const done = scene.playRelease(key).then(() => { log.push(`release:done:${Math.round(performance.now() - started)}`); status(); });
    brood = brood.filter(baby => baby.key !== key);
    scene.setBrood(brood);
    return done;
  },
  celebrate: (key = brood[brood.length - 1]?.key ?? player.key) => scene.celebrate(key),
  addBaby: (tier: TierId = "mutant") => { const baby = makeBaby(player, pool[(nextPlay * 5) % pool.length], nextPlay++, tier); brood = [...brood, baby]; scene.setBrood(brood); return baby.key; },
  hatch: startHatch,
  skip: () => hatch?.skip(),
  closeHatch,
  eggs: (value: number) => { eggs = value; scene.setEggCount(eggs); },
  pause: (value: boolean) => scene.setPaused(value),
  reduced: (value: boolean) => { reducedMotion = value; scene.setReducedMotion(value); },
  destroy: () => scene.destroy(),
};
(window as unknown as { __harness: typeof api }).__harness = api;

function status() {
  const node = document.getElementById("status");
  if (node) node.textContent = log.slice(-6).join("  |  ");
}

const buttons: [string, () => unknown][] = [
  ["Courtship", () => api.courtship(Math.floor(Math.random() * 60))],
  ["Release first", () => api.release()],
  ["Celebrate newest", () => api.celebrate()],
  ["Add baby", () => api.addBaby(TIER_ORDER[Math.floor(Math.random() * 4)])],
  ...TIER_ORDER.map(tier => [`Hatch ${tier}`, () => startHatch(tier, Math.floor(Math.random() * 60))] as [string, () => unknown]),
  ["Skip hatch", () => api.skip()],
  ["Close hatch", closeHatch],
  ["Egg +1", () => api.eggs(eggs + 1)],
  ["Egg -1", () => api.eggs(Math.max(0, eggs - 1))],
  ["Pause", () => { const next = !(world.dataset.paused === "1"); world.dataset.paused = next ? "1" : ""; scene.setPaused(next); }],
  ["Reduced motion", () => api.reduced(!reducedMotion)],
];
const bar = document.getElementById("controls")!;
for (const [label, run] of buttons) {
  const button = document.createElement("button");
  button.type = "button"; button.textContent = label;
  button.addEventListener("click", () => { void run(); });
  bar.append(button);
}
status();
