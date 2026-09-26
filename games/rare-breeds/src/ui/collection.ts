// Collection goal: breed babies from all 9 Friend families and find all 4 hatch tiers.
// Rule: a family counts once any hatched baby (kept or sent to the Sanctuary) has it in its
// family label ("Cellular × Hollow", i.e. the families of both parents). A tier counts once any
// egg hatched that tier. Pure helpers, no SDK or DOM imports.
import { FAMILY_NAMES } from "../sprites.ts";
import { TIER_ORDER, TIER_STYLE, type Creature, type TierId } from "../types.ts";

export type Collection = Readonly<{
  /** Collected family names, in FAMILY_NAMES order. */
  families: readonly string[];
  /** Tiers found, in TIER_ORDER order. */
  tiers: readonly TierId[];
}>;

export const ALL_FAMILIES: readonly string[] = FAMILY_NAMES;
export const ALL_TIERS: readonly TierId[] = TIER_ORDER;
export const EMPTY_COLLECTION: Collection = Object.freeze({ families: Object.freeze([]), tiers: Object.freeze([]) });

/** The Friend families a baby carries, read from its family label (both separators "×" and "x" accepted). */
export function familiesOf(baby: Creature): string[] {
  const parts = baby.family.split(/\s+[×x]\s+/).map(part => part.trim());
  return ALL_FAMILIES.filter(name => parts.includes(name));
}

/** Family of a Friend or wild Friend as genetics names it (by family id). Babies carry their dominant family. */
export const familyOf = (creature: Creature) => ALL_FAMILIES[creature.familyId] ?? creature.family;

/** Build the collection from every hatched baby we still know about plus the tier of every settled hatch. */
export function buildCollection(babies: Iterable<Creature | null | undefined>, tiers: Iterable<TierId | undefined> = []): Collection {
  const families = new Set<string>(), found = new Set<TierId>();
  for (const baby of babies) {
    if (!baby) continue;
    for (const family of familiesOf(baby)) families.add(family);
    if (baby.tier) found.add(baby.tier);
  }
  for (const tier of tiers) if (tier) found.add(tier);
  return Object.freeze({
    families: Object.freeze(ALL_FAMILIES.filter(name => families.has(name))),
    tiers: Object.freeze(ALL_TIERS.filter(tier => found.has(tier))),
  });
}

export const familiesComplete = (collection: Collection) => collection.families.length >= ALL_FAMILIES.length;
export const tiersComplete = (collection: Collection) => collection.tiers.length >= ALL_TIERS.length;

/**
 * What a freshly hatched baby adds to the collection it hatched into (`before` must not include it yet).
 * Preformatted lines for the reveal card, e.g. ["New family: Hollow · 3/9", "First Mutant · 2/4 tiers"].
 */
export function discoveriesOf(baby: Creature, before: Collection): string[] {
  const lines: string[] = [];
  const families = familiesOf(baby).filter(name => !before.families.includes(name));
  const familyCount = before.families.length + families.length;
  // Both families already show in the card's family line, so two new ones only need the count.
  if (families.length) {
    lines.push(familyCount >= ALL_FAMILIES.length ? `All ${ALL_FAMILIES.length} families collected!`
      : `${families.length === 1 ? `New family: ${families[0]}` : `${families.length} new families`} · ${familyCount}/${ALL_FAMILIES.length}`);
  }
  const tier = baby.tier;
  if (tier && !before.tiers.includes(tier)) {
    const tierCount = before.tiers.length + 1;
    lines.push(tierCount >= ALL_TIERS.length ? `All ${ALL_TIERS.length} tiers found!`
      : `First ${TIER_STYLE[tier].label} · ${tierCount}/${ALL_TIERS.length} tiers`);
  }
  return lines;
}
