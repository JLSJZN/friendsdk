// The page's cast: the game's 73 wild Friends (data/wild-friends.json, real on-chain sprites) and babies bred from
// them with the game's own genetics. Nothing here is saved or spent: it is the same maths the game runs, for show.
import { breed, breedSeed } from "../../src/genetics.ts";
import { FAMILY_NAMES, creatureFromRecord, type WildFriendRecord } from "../../src/sprites.ts";
import { TIER_ORDER, type Creature, type TierId } from "../../src/types.ts";

export type Pool = Readonly<{
  friends: readonly Creature[];
  /** Friends per family id (0-8), pool order. */
  byFamily: readonly (readonly Creature[])[];
  get(id: bigint): Creature;
}>;

export async function loadPool(url = "./data/wild-friends.json"): Promise<Pool> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The Friend pool did not load (${response.status}).`);
  const data = await response.json() as { friends: WildFriendRecord[] };
  const friends = data.friends.map(record => creatureFromRecord(record));
  const byFamily = FAMILY_NAMES.map((_, id) => friends.filter(friend => friend.familyId === id));
  const index = new Map(friends.map(friend => [friend.tokenId!, friend]));
  return Object.freeze({
    friends, byFamily,
    get(id: bigint) {
      const friend = index.get(id);
      if (!friend) throw new Error(`Friend #${id} is not in the pool.`);
      return friend;
    },
  });
}

const hatched = new Map<string, Creature>();

/**
 * One baby exactly as the game hatches it: seed from (parent A's token, both keys, play), then breed() at `tier`.
 * Same wrapper as the intro's example babies (src/ui/intro.ts). Cached, so the same egg always shows the same baby.
 */
export function hatch(a: Creature, b: Creature, tier: TierId, playId = 0n): Creature {
  const key = `${a.key}|${b.key}|${playId}|${tier}`;
  const known = hatched.get(key);
  if (known) return known;
  const seed = breedSeed(a.tokenId ?? 0n, a.key, b.key, playId);
  const result = breed({ a, b, tier, playId, seed });
  const baby: Creature = Object.freeze({
    key: `baby:${key}`, kind: "baby", name: result.name, family: result.family, familyId: result.familyId,
    lineage: result.lineage, sheet: result.sheet, tier, parents: [a.key, b.key] as const, dna: result.dna, playId,
  });
  hatched.set(key, baby);
  return baby;
}

/** The same egg in all four tiers (same rows; only the tier pattern and new shapes differ). */
export const allTiers = (a: Creature, b: Creature, playId = 0n) =>
  Object.fromEntries(TIER_ORDER.map(tier => [tier, hatch(a, b, tier, playId)])) as Record<TierId, Creature>;

/** Rows each parent gave: [from A, from B]. */
export function rowCounts(baby: Creature): readonly [number, number] {
  const rows = baby.dna?.rowSource ?? [];
  const b = rows.filter(source => source === 1).length;
  return [rows.length - b, b];
}

/** Uniform random integer below `max` from the browser's crypto (a fresh mate, a fresh play). */
export function randomBelow(max: number) {
  const word = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  do crypto.getRandomValues(word); while (word[0] >= limit);
  return word[0] % max;
}
