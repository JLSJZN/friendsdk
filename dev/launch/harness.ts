// Dev-only harness for the Moon Slingshot flight (src/scene/launch.ts). A small driver stands in for the UI's flight
// clock: ignite, fly(ms) every frame until the flight is decided, then end().
// URL flags: end=fizzle|crash|jump|moon, at=<hundredths> (crash point for crash, exit for jump; defaults 299 and 440),
// tier=common|spotted|mutant|prismatic, hat=<accessory id>, reduced=1, w=<frame css width>, h=<frame css height> (a portrait
// frame, e.g. w=390&h=650), clean=1 (no controls), safe=1 (shows the UI's reserved bands), auto=1 (plays on load), baby=<index>
import wild from "../../games/rare-breeds/data/wild-friends.json";
import type { LaunchSequence } from "../../games/rare-breeds/src/api.ts";
import { breed, breedSeed } from "../../games/rare-breeds/src/genetics.ts";
import { createLaunchSequence } from "../../games/rare-breeds/src/scene/launch.ts";
import { MOON_HUNDREDTHS, msToReach, type FlightEnd } from "../../games/rare-breeds/src/slingshot.ts";
import { creatureFromRecord, type WildFriendRecord } from "../../games/rare-breeds/src/sprites.ts";
import { TIER_ORDER, type AccessoryId, type Creature, type TierId } from "../../games/rare-breeds/src/types.ts";

const params = new URLSearchParams(location.search);
const records = (wild as { friends: WildFriendRecord[] }).friends;
const player = creatureFromRecord(records[0], "friend");
const pool = records.slice(1).map(record => creatureFromRecord(record));
const log: string[] = [];
const frame = document.getElementById("frame") as HTMLDivElement;
if (params.get("w")) frame.style.width = `${Number(params.get("w"))}px`;
if (params.get("h")) { frame.style.height = `${Number(params.get("h"))}px`; frame.style.aspectRatio = "auto"; }
if (params.get("clean") === "1") document.body.classList.add("clean");
if (params.get("safe") === "1") for (const kind of ["top", "bottom", "skip"]) {
  const node = document.createElement("div");
  node.className = `safe ${kind}`;
  frame.append(node);
}

const ENDS: readonly FlightEnd[] = ["fizzle", "crash", "jump", "moon"];
const DEFAULT_AT: Readonly<Record<FlightEnd, number>> = { fizzle: 95, crash: 299, jump: 440, moon: MOON_HUNDREDTHS };
/** When the flight is decided (ms after ignition): a fizzle at once, a crash once the multiplier passes its crash point, a jump at its exit, the Moon at 9 s. */
const decidedAt = (end: FlightEnd, at: number) => end === "fizzle" ? 0 : end === "crash" ? msToReach(Math.min(MOON_HUNDREDTHS, at + 1))
  : msToReach(end === "jump" ? at : MOON_HUNDREDTHS);

function makeBaby(index: number, tier: TierId, accessory?: AccessoryId): Creature {
  const mate = pool[(index * 7 + 3) % pool.length];
  const playId = BigInt(index + 1);
  const result = breed({ a: player, b: mate, tier, playId, seed: breedSeed(player.tokenId!, player.key, mate.key, playId) });
  return Object.freeze({
    key: `baby:${playId}`, kind: "baby", name: result.name, family: result.family, familyId: result.familyId,
    lineage: result.lineage, sheet: result.sheet, tier, parents: [player.key, mate.key] as const, dna: result.dna, playId, accessory,
  });
}

type Options = { at?: number; tier?: TierId; baby?: number; hat?: AccessoryId | null; reduced?: boolean };
let sequence: LaunchSequence | null = null;
let reduced = params.get("reduced") === "1";
let started = 0, raf = 0;

/** A fresh canvas and sequence on the pad (the ready frame). */
function ready(options: Options = {}) {
  cancelAnimationFrame(raf);
  sequence?.destroy();
  const old = document.getElementById("overlay") as HTMLCanvasElement;
  const canvas = old.cloneNode() as HTMLCanvasElement;
  old.replaceWith(canvas);
  canvas.style.opacity = "";
  const tier = options.tier ?? (params.get("tier") as TierId) ?? "spotted";
  const hat = options.hat === undefined ? (params.get("hat") as AccessoryId | null) ?? undefined : options.hat ?? undefined;
  const baby = makeBaby(options.baby ?? Number(params.get("baby") ?? 2), tier || "spotted", hat);
  log.length = 0;
  started = performance.now();
  sequence = createLaunchSequence({ canvas, baby, reducedMotion: options.reduced ?? reduced, onBeat: beat => { log.push(`beat:${beat}:${Math.round(performance.now() - started)}`); status(); } });
  log.push(`ready:${baby.name}:${tier}`);
  status();
  return sequence;
}

/** Plays one flight: ignition now, the ending when the flight is decided. Resolves with the total ms (flight and ending). */
function play(end: FlightEnd = (params.get("end") as FlightEnd) || "jump", options: Options = {}) {
  const at = options.at ?? (Number(params.get("at")) || DEFAULT_AT[end]);
  const current = ready(options);
  log.push(`play:${end}:${at}`);
  const target = decidedAt(end, at);
  current.ignite();
  return new Promise<number>(resolve => {
    const tick = () => {
      const ms = performance.now() - started;
      if (ms < target) { current.fly(ms); raf = requestAnimationFrame(tick); return; }
      current.fly(target);
      log.push(`decided:${Math.round(ms)}`);
      void current.end(end, end === "jump" ? at : end === "moon" ? MOON_HUNDREDTHS : null).then(() => {
        const total = Math.round(performance.now() - started);
        log.push(`done:${total}`); status(); resolve(total);
      });
    };
    raf = requestAnimationFrame(tick);
  });
}

const api = { play, ready, log, decidedAt, skip: () => sequence?.skip(), destroy: () => { cancelAnimationFrame(raf); sequence?.destroy(); sequence = null; }, ends: ENDS, tiers: TIER_ORDER };
(window as unknown as { __launch: typeof api }).__launch = api;

function status() {
  const node = document.getElementById("status");
  if (node) node.textContent = log.slice(-6).join("  |  ");
}

const bar = document.getElementById("controls")!;
const buttons: [string, () => unknown][] = [
  ["Ready", () => ready()],
  ...ENDS.map(end => [end, () => play(end)] as [string, () => unknown]),
  ["Random tier", () => play((params.get("end") as FlightEnd) || "jump", { tier: TIER_ORDER[Math.floor(Math.random() * 4)], baby: Math.floor(Math.random() * 40) })],
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
