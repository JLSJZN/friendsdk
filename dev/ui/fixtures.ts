// Dev-only fixture data for the Rare Breeds UI harness. Real Friend art, made-up babies.
import wildData from "../../games/rare-breeds/data/wild-friends.json";
import gameJson from "../../games/rare-breeds/game.json";
import { describeTiers, type TierRow } from "../../games/rare-breeds/src/economy.ts";
import { creatureFromRecord, type WildFriendRecord } from "../../games/rare-breeds/src/sprites.ts";
import { FACINGS, FRAME_SIZE, TIER_ORDER, type Creature, type Dna, type Frame, type SpriteSheet, type TierId } from "../../games/rare-breeds/src/types.ts";
import type { TierInfo } from "../../games/rare-breeds/src/ui/index.ts";

const records = (wildData as { friends: WildFriendRecord[] }).friends;
const byId = (id: string) => {
  const record = records.find(entry => entry.id === id);
  if (!record) throw new Error(`Fixture Friend #${id} missing`);
  return record;
};

export const player: Creature = creatureFromRecord(records[0], "friend");
export const wild: Creature[] = ["62164", "309298", "78874", "238395", "277088", "183866"].map(id => creatureFromRecord(byId(id)));
export const candidates = wild.slice(0, 3);
export const rerolled = wild.slice(3, 6);

function rng(seed: number) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state ^ (state >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return state / 4294967296; };
}

function mixSheet(a: SpriteSheet, b: SpriteSheet, rowSource: readonly (0 | 1)[], extra: readonly number[]): SpriteSheet {
  const clip = (name: "idle" | "walk") => Object.freeze(Object.fromEntries(FACINGS.map(facing => [facing,
    a[name][facing].map((frameA, index) => {
      const frameB = b[name][facing][index];
      const out: Frame = new Uint8Array(FRAME_SIZE * FRAME_SIZE);
      for (let row = 0; row < FRAME_SIZE; row++) {
        const source = rowSource[row] ? frameB : frameA;
        out.set(source.subarray(row * FRAME_SIZE, (row + 1) * FRAME_SIZE), row * FRAME_SIZE);
      }
      for (const cell of extra) out[cell] = 1;
      return out;
    })])) as unknown as SpriteSheet["idle"]);
  return Object.freeze({ idle: clip("idle"), walk: clip("walk") });
}

function pattern(tier: TierId, random: () => number) {
  const stencil = new Uint8Array(FRAME_SIZE * FRAME_SIZE);
  for (let index = 0; index < stencil.length; index++) {
    const x = index % FRAME_SIZE, y = Math.floor(index / FRAME_SIZE);
    if (tier === "spotted") stencil[index] = (x * 3 + y * 5) % 7 === 0 ? 1 : 0;
    else if (tier === "mutant") stencil[index] = y % 4 === 1 ? 1 : 0;
    else if (tier === "prismatic") stencil[index] = (x + y) % 2 === 0 || random() < .2 ? 1 : 0;
  }
  return stencil;
}

const TRAITS: Record<TierId, readonly string[]> = {
  common: [],
  spotted: ["Spots"],
  mutant: ["Antennae", "Stripes"],
  prismatic: ["Prism skin", "Tall ears", "Sparkle trail"],
};

export function makeBaby(options: { name: string; a: Creature; b: Creature; tier: TierId; playId: number; seed: number; lineage?: number }): Creature {
  const random = rng(options.seed);
  const rowSource = Array.from({ length: FRAME_SIZE }, () => (random() < .5 ? 0 : 1) as 0 | 1);
  const mutations = options.tier === "mutant" ? [1 * 16 + 4, 0 * 16 + 4, 1 * 16 + 11, 0 * 16 + 11]
    : options.tier === "prismatic" ? [2 * 16 + 2, 2 * 16 + 13, 9 * 16 + 1] : [];
  const dna: Dna = Object.freeze({ rowSource, pattern: pattern(options.tier, random), mutations, traits: TRAITS[options.tier] });
  return Object.freeze({
    key: `baby:${options.playId}`, kind: "baby", name: options.name,
    family: `${options.a.family} x ${options.b.family}`, familyId: options.a.familyId,
    lineage: options.lineage ?? Math.max(options.a.lineage, options.b.lineage) + 1,
    sheet: mixSheet(options.a.sheet, options.b.sheet, rowSource, mutations),
    tier: options.tier, parents: [options.a.key, options.b.key] as const, dna, playId: BigInt(options.playId),
  });
}

export const babies: Creature[] = [
  makeBaby({ name: "Zibu", a: player, b: wild[0], tier: "mutant", playId: 1, seed: 11 }),
  makeBaby({ name: "Pom", a: player, b: wild[1], tier: "common", playId: 2, seed: 23 }),
  makeBaby({ name: "Kiki", a: player, b: wild[2], tier: "spotted", playId: 3, seed: 37 }),
  makeBaby({ name: "Oro", a: player, b: wild[3], tier: "prismatic", playId: 4, seed: 41 }),
];
babies.push(makeBaby({ name: "Mochi-Moo", a: babies[0], b: wild[4], tier: "spotted", playId: 5, seed: 53 }));
babies.push(makeBaby({ name: "Tofu", a: babies[4], b: babies[2], tier: "common", playId: 6, seed: 61 }));

const lookup = new Map<string, Creature>([player, ...wild, ...babies].map(creature => [creature.key, creature]));
export const creature = (key: string) => lookup.get(key) ?? null;

export const tiers: TierInfo[] = TIER_ORDER.map((tier, index) => ({
  tier, chance: ["62%", "25%", "10%", "3%"][index], value: ["0.25 RF", "1 RF", "2.5 RF", "8 RF"][index],
}));
export const tierInfo = (tier: TierId) => tiers.find(row => row.tier === tier)!;

/** Tier rows from the real game.json (Common 0.5 / Spotted 1 / Mutant 1.5 / Prismatic 6 RF), as describeTiers(definition) returns them. */
export const tierRows: readonly TierRow[] = describeTiers({
  ...gameJson, price: BigInt(gameJson.price), outcomes: gameJson.outcomes.map(outcome => ({ ...outcome, reward: BigInt(outcome.reward) })),
} as unknown as Parameters<typeof describeTiers>[0]);
export const tierValue = (tier: TierId | undefined) => tierRows.find(row => row.tier === (tier ?? "common"))!.reward;
