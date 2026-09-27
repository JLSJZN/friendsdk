// Rare Breeds breed book: one name for every unordered pair of the 9 Friend families (9 purebreds + 36 crosses = 45).
// A baby's breed comes from the families in its label (familiesOf in src/ui/collection.ts). Pure, no SDK imports.
import { FAMILY_NAMES } from "./sprites.ts";

/** Row i pairs FAMILY_NAMES[i] with FAMILY_NAMES[i], FAMILY_NAMES[i + 1], ... FAMILY_NAMES[8]. */
const NAMES: readonly (readonly string[])[] = [
  ["Rattlebones", "Trick or Treat", "Skeleton Crew", "Jelly Bones", "Funny Bone", "Bone Drone", "Dino Bones", "Bling Bones", "Ghost Bones"],
  ["Masquerade", "Undercover Cousin", "Mystery Goo", "Wink Ninja", "Sky Ninja", "Masked Wrestler", "Glitter Bandit", "Nobody Home"],
  ["Family Reunion", "Blob Squad", "Odd Cousin", "Balloon Parade", "Growth Spurt", "Party Animals", "Haunted House"],
  ["Cell Division", "Wobble Blob", "Jellyfish", "Gummy Giant", "Sparkle Slime", "Bubble Wrap"],
  ["Topsy Turvy", "Wonky Kite", "Leaning Tower", "Glitter Glitch", "Lopsided Donut"],
  ["Frequent Flyer", "Blimp", "Shooting Star", "Air Pocket"],
  ["Absolute Unit", "Twinkle Titan", "Bouncy Castle"],
  ["Disco Ball", "Disco Ghost"],
  ["Hole in One"],
];

export type Breed = Readonly<{ name: string; families: readonly [string, string] }>;

/** All 45 breeds in book order (FAMILY_NAMES order, purebred first in each family's run). */
export const BREEDS: readonly Breed[] = Object.freeze(NAMES.flatMap((row, i) => row.map((name, k) =>
  Object.freeze({ name, families: Object.freeze([FAMILY_NAMES[i], FAMILY_NAMES[i + k]] as const) }))));

/** The breed of one or two family names (order does not matter; one name is its purebred). Null for anything else. */
export function breedOf(families: readonly string[]): Breed | null {
  const ids = families.map(name => (FAMILY_NAMES as readonly string[]).indexOf(name)).sort((p, q) => p - q);
  if (!ids.length || ids.length > 2 || ids[0] < 0) return null;
  const [low, high = low] = ids;
  return BREEDS.find(breed => breed.families[0] === FAMILY_NAMES[low] && breed.families[1] === FAMILY_NAMES[high]) ?? null;
}
