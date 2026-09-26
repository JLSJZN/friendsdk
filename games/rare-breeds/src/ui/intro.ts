// Example babies for the intro tour. Presentation only: they are never kept, sold or counted, and the
// real hatch tier always comes from the SDK. Same genetics as a real hatch, with a fixed example seed.
import { breed, breedSeed } from "../genetics.ts";
import { TIER_ORDER, type Creature, type Dna, type TierId } from "../types.ts";

/** Play id reserved for examples. Real SDK play ids start at 1, so an example never matches a real baby. */
export const EXAMPLE_PLAY = 0n;

/** The same pair bred once per tier (same seed, so the same rows; only the tier pattern and mutations differ). */
export function exampleBabies(parentA: Creature, parentB: Creature): Readonly<Record<TierId, Creature>> {
  const seed = breedSeed(parentA.tokenId ?? 0n, parentA.key, parentB.key, EXAMPLE_PLAY);
  const entries = TIER_ORDER.map(tier => {
    const result = breed({ a: parentA, b: parentB, tier, playId: EXAMPLE_PLAY, seed });
    const baby: Creature = Object.freeze({
      key: `example:${tier}`, kind: "baby", name: "Example baby", family: result.family, familyId: result.familyId,
      lineage: result.lineage, sheet: result.sheet, tier, parents: [parentA.key, parentB.key] as const, dna: result.dna,
    });
    return [tier, baby] as const;
  });
  return Object.freeze(Object.fromEntries(entries) as Record<TierId, Creature>);
}

/** A DNA ribbon where every row comes from one parent (0 = parent A, 1 = parent B). */
export function singleParentDna(source: 0 | 1): Dna {
  return Object.freeze({ rowSource: Object.freeze(Array(16).fill(source)), pattern: new Uint8Array(256), mutations: Object.freeze([]), traits: Object.freeze([]) });
}
