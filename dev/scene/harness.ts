// Dev-only harness for the Rare Breeds renderer (nursery scene + hatch overlay).
// URL flags: babies=N, tier=common|spotted|mutant|prismatic, reduced=1, fake=1, clean=1, eggs=N, w=<frame css width>,
// chrome=1 (phone UI stand-ins over the world, to judge the camera band)
import wild from "../../games/rare-breeds/data/wild-friends.json";
import { breed, breedSeed } from "../../games/rare-breeds/src/genetics.ts";
import { createHatchSequence } from "../../games/rare-breeds/src/scene/hatch.ts";
import { createNurseryScene } from "../../games/rare-breeds/src/scene/nursery.ts";
import { creatureFromRecord, type WildFriendRecord } from "../../games/rare-breeds/src/sprites.ts";
import { TIER_ORDER, type Creature, type TierId } from "../../games/rare-breeds/src/types.ts";
import type { HatchSequence } from "../../games/rare-breeds/src/api.ts";
import { fakeBaby } from "./fake.ts";

const params = new URLSearchParams(location.search);
const records = (wild as { friends: WildFriendRecord[] }).friends;
const player = creatureFromRecord(records[0], "friend");
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

const api = {
  scene, log, player, pool,
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
