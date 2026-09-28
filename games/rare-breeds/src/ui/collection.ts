// Collection goal: breed babies from all 9 Friend families and find all 4 hatch tiers.
// Rule: a family counts once any hatched baby (kept or sent to the Sanctuary) has it in its
// family label ("Cellular × Hollow", i.e. the families of both parents). A tier counts once any
// egg hatched that tier. On the side: the breed book (45 named family pairs, src/breeds.ts) and
// lineage titles (src/titles.ts), both cosmetic. Pure helpers, no SDK or DOM imports.
import { BREEDS, breedOf, type Breed } from "../breeds.ts";
import { FAMILY_NAMES } from "../sprites.ts";
import { TITLE_NAME, TITLE_ORDER, type LineageTitle, type TitleId } from "../titles.ts";
import { TIER_ORDER, TIER_STYLE, type Creature, type TierId } from "../types.ts";

export type Collection = Readonly<{
  /** Collected family names, in FAMILY_NAMES order. */
  families: readonly string[];
  /** Tiers found, in TIER_ORDER order. */
  tiers: readonly TierId[];
  /** Breed names found, in BREEDS order. */
  breeds: readonly string[];
  /** Lineage titles any baby has earned, in TITLE_ORDER. */
  titles: readonly TitleId[];
}>;

export const ALL_FAMILIES: readonly string[] = FAMILY_NAMES;
export const ALL_TIERS: readonly TierId[] = TIER_ORDER;
export const ALL_BREEDS: readonly Breed[] = BREEDS;
export const EMPTY_COLLECTION: Collection = Object.freeze({ families: Object.freeze([]), tiers: Object.freeze([]), breeds: Object.freeze([]), titles: Object.freeze([]) });

/** The Friend families a baby carries, read from its family label (both separators "×" and "x" accepted). */
export function familiesOf(baby: Creature): string[] {
  const parts = baby.family.split(/\s+[×x]\s+/).map(part => part.trim());
  return ALL_FAMILIES.filter(name => parts.includes(name));
}

/** A baby's breed: the named pair of the families in its label ("Skeleton × Hollow" is Ghost Bones). */
export const breedOfBaby = (baby: Creature) => breedOf(familiesOf(baby));

/** Family of a Friend or wild Friend as genetics names it (by family id). Babies carry their dominant family. */
export const familyOf = (creature: Creature) => ALL_FAMILIES[creature.familyId] ?? creature.family;

/**
 * Build the collection from every hatched baby we still know about plus the tier of every settled hatch.
 * `titlesOf` names each baby's lineage titles (e.g. lineageTitles with the lineage lookup); omit it to skip titles.
 */
export function buildCollection(babies: Iterable<Creature | null | undefined>, tiers: Iterable<TierId | undefined> = [],
  titlesOf?: (baby: Creature) => readonly LineageTitle[]): Collection {
  const families = new Set<string>(), found = new Set<TierId>(), breeds = new Set<string>(), titles = new Set<TitleId>();
  for (const baby of babies) {
    if (!baby) continue;
    for (const family of familiesOf(baby)) families.add(family);
    if (baby.tier) found.add(baby.tier);
    const breed = breedOfBaby(baby);
    if (breed) breeds.add(breed.name);
    for (const title of titlesOf?.(baby) ?? []) titles.add(title.id);
  }
  for (const tier of tiers) if (tier) found.add(tier);
  return Object.freeze({
    families: Object.freeze(ALL_FAMILIES.filter(name => families.has(name))),
    tiers: Object.freeze(ALL_TIERS.filter(tier => found.has(tier))),
    breeds: Object.freeze(ALL_BREEDS.map(breed => breed.name).filter(name => breeds.has(name))),
    titles: Object.freeze(TITLE_ORDER.filter(id => titles.has(id))),
  });
}

export const familiesComplete = (collection: Collection) => collection.families.length >= ALL_FAMILIES.length;
export const tiersComplete = (collection: Collection) => collection.tiers.length >= ALL_TIERS.length;

/** The reveal card's news for the shapes a baby inherited, one line per parent: ["Inherited: Horns and Tail from Sasa!"]. */
export function inheritedNews(baby: Creature): string[] {
  const bySource = new Map<string, string[]>();
  for (const shape of baby.dna?.shapes ?? []) if (shape.from) bySource.set(shape.from.name, [...bySource.get(shape.from.name) ?? [], shape.label]);
  return [...bySource].map(([name, labels]) => `Inherited: ${labels.join(" and ")} from ${name}!`);
}

/** The reveal card's Gene Lab line, e.g. ["Locked 5 rows, all inherited"]: how many locked rows came from the chosen parent. */
export function lockedNews(baby: Creature): string[] {
  const locks = baby.dna?.locks, rowSource = baby.dna?.rowSource;
  const locked = (locks ?? []).flatMap((lock, row) => lock === null ? [] : [row]);
  if (!locks || !rowSource || !locked.length) return [];
  const kept = locked.filter(row => rowSource[row] === locks[row]).length;
  if (locked.length === 1) return [kept ? "Locked 1 row, inherited" : "Locked 1 row, not inherited"];
  return [`Locked ${locked.length} rows, ${kept === locked.length ? "all" : kept} inherited`];
}

/**
 * What a freshly hatched baby adds to the collection it hatched into (`before` must not include it yet).
 * Preformatted lines for the reveal card, e.g. ["New family: Hollow · 3/9", "First Mutant · 2/4 tiers",
 * "New breed: Ghost Bones · 4/45", "First Chimera: rows from 4 different Friends, just for show"]. `titles`: the
 * baby's lineage titles; a first title explains itself, since touch screens have no tooltip.
 */
export function discoveriesOf(baby: Creature, before: Collection, titles: readonly LineageTitle[] = []): string[] {
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
  const breed = breedOfBaby(baby);
  if (breed && !before.breeds.includes(breed.name)) {
    const breedCount = before.breeds.length + 1;
    lines.push(breedCount >= ALL_BREEDS.length ? `All ${ALL_BREEDS.length} breeds found!` : `New breed: ${breed.name} · ${breedCount}/${ALL_BREEDS.length}`);
  }
  for (const title of titles) if (!before.titles.includes(title.id)) lines.push(`First ${TITLE_NAME[title.id]}: ${title.detail}, just for show`);
  return lines;
}
