// Dev-only harness for the Moon Slingshot flight overlay (src/scene/launch.ts).
// URL flags: zone=<LaunchZoneId>, pull=0..1, tier=common|spotted|mutant|prismatic, hat=<accessory id>, reduced=1,
// w=<frame css width>, clean=1 (no controls), safe=1 (shows the UI's reserved bands), auto=1 (plays on load), baby=<index>
import wild from "../../games/rare-breeds/data/wild-friends.json";
import type { LaunchSequence } from "../../games/rare-breeds/src/api.ts";
import { breed, breedSeed } from "../../games/rare-breeds/src/genetics.ts";
import { createLaunchSequence } from "../../games/rare-breeds/src/scene/launch.ts";
import { creatureFromRecord, type WildFriendRecord } from "../../games/rare-breeds/src/sprites.ts";
import { LAUNCH_ZONE_ORDER, TIER_ORDER, type AccessoryId, type Creature, type LaunchZoneId, type TierId } from "../../games/rare-breeds/src/types.ts";

const params = new URLSearchParams(location.search);
const records = (wild as { friends: WildFriendRecord[] }).friends;
const player = creatureFromRecord(records[0], "friend");
const pool = records.slice(1).map(record => creatureFromRecord(record));
const log: string[] = [];
const frame = document.getElementById("frame") as HTMLDivElement;
if (params.get("w")) frame.style.width = `${Number(params.get("w"))}px`;
if (params.get("clean") === "1") document.body.classList.add("clean");
if (params.get("safe") === "1") for (const kind of ["top", "bottom", "skip"]) {
  const node = document.createElement("div");
  node.className = `safe ${kind}`;
  frame.append(node);
}

function makeBaby(index: number, tier: TierId, accessory?: AccessoryId): Creature {
  const mate = pool[(index * 7 + 3) % pool.length];
  const playId = BigInt(index + 1);
  const result = breed({ a: player, b: mate, tier, playId, seed: breedSeed(player.tokenId!, player.key, mate.key, playId) });
  return Object.freeze({
    key: `baby:${playId}`, kind: "baby", name: result.name, family: result.family, familyId: result.familyId,
    lineage: result.lineage, sheet: result.sheet, tier, parents: [player.key, mate.key] as const, dna: result.dna, playId, accessory,
  });
}

let sequence: LaunchSequence | null = null;
let reduced = params.get("reduced") === "1";
let started = 0;

/** Plays one flight on a fresh canvas. Resolves with the play() duration (ms). */
function play(zone: LaunchZoneId = (params.get("zone") as LaunchZoneId) || "moon", options: { pull?: number; tier?: TierId; baby?: number; hat?: AccessoryId | null; reduced?: boolean } = {}) {
  sequence?.destroy();
  const old = document.getElementById("overlay") as HTMLCanvasElement;
  const canvas = old.cloneNode() as HTMLCanvasElement;
  old.replaceWith(canvas);
  canvas.style.opacity = "";
  const tier = options.tier ?? (params.get("tier") as TierId) ?? "spotted";
  const hat = options.hat === undefined ? (params.get("hat") as AccessoryId | null) ?? undefined : options.hat ?? undefined;
  const baby = makeBaby(options.baby ?? Number(params.get("baby") ?? 2), tier || "spotted", hat);
  const pull = options.pull ?? Number(params.get("pull") ?? 0.7);
  log.length = 0;
  log.push(`play:${zone}:${baby.name}:${tier}`);
  sequence = createLaunchSequence({ canvas, baby, zone, pull, reducedMotion: options.reduced ?? reduced, onBeat: beat => { log.push(`beat:${beat}:${Math.round(performance.now() - started)}`); status(); } });
  started = performance.now();
  status();
  return sequence.play().then(() => { const ms = Math.round(performance.now() - started); log.push(`done:${ms}`); status(); return ms; });
}

const api = { play, log, skip: () => sequence?.skip(), destroy: () => { sequence?.destroy(); sequence = null; }, zones: LAUNCH_ZONE_ORDER, tiers: TIER_ORDER };
(window as unknown as { __launch: typeof api }).__launch = api;

function status() {
  const node = document.getElementById("status");
  if (node) node.textContent = log.slice(-6).join("  |  ");
}

const bar = document.getElementById("controls")!;
const buttons: [string, () => unknown][] = [
  ...LAUNCH_ZONE_ORDER.map(zone => [zone, () => play(zone)] as [string, () => unknown]),
  ["Random tier", () => play((params.get("zone") as LaunchZoneId) || "moon", { tier: TIER_ORDER[Math.floor(Math.random() * 4)], baby: Math.floor(Math.random() * 40) })],
  ["Skip", () => api.skip()],
  ["Reduced motion", () => { reduced = !reduced; log.push(`reduced:${reduced}`); status(); }],
];
for (const [label, run] of buttons) {
  const button = document.createElement("button");
  button.type = "button"; button.textContent = label;
  button.addEventListener("click", () => { void run(); });
  bar.append(button);
}
status();
if (params.get("auto") === "1") void play();
