// Breed book tests: one name per unordered family pair. Run from the SDK root: node --test "games/rare-breeds/tests/*.test.ts"
import assert from "node:assert/strict";
import test from "node:test";
import { BREEDS, breedOf } from "../src/breeds.ts";
import { FAMILY_NAMES } from "../src/sprites.ts";
import { breedOfBaby, buildCollection, discoveriesOf, EMPTY_COLLECTION, inheritedNews } from "../src/ui/collection.ts";
import type { Creature } from "../src/types.ts";

const labelled = (family: string, key = family): Creature =>
  ({ key: `baby:${key}`, kind: "baby", name: key, family, familyId: 0, lineage: 1, sheet: { idle: {}, walk: {} } as Creature["sheet"], tier: "common" });

test("45 unique names cover every unordered family pair exactly once", () => {
  assert.equal(BREEDS.length, 45);
  assert.equal(new Set(BREEDS.map(breed => breed.name)).size, 45, "names are unique");
  const pairs = new Set<string>();
  for (let i = 0; i < FAMILY_NAMES.length; i++) for (let j = i; j < FAMILY_NAMES.length; j++) pairs.add(`${FAMILY_NAMES[i]}|${FAMILY_NAMES[j]}`);
  assert.equal(pairs.size, 45);
  assert.deepEqual(new Set(BREEDS.map(breed => breed.families.join("|"))), pairs);
  for (const breed of BREEDS) {
    assert.match(breed.name, /^[A-Z][A-Za-z]*( [A-Za-z]+)*$/, `plain letters and spaces, no dashes: ${breed.name}`);
    assert.ok(breed.name.length <= 17, `short enough for a phone card: ${breed.name}`);
  }
});

test("breedOf is order independent; one family is its purebred", () => {
  for (const breed of BREEDS) {
    const [a, b] = breed.families;
    assert.equal(breedOf([a, b])?.name, breed.name);
    assert.equal(breedOf([b, a])?.name, breed.name);
    if (a === b) assert.equal(breedOf([a])?.name, breed.name);
  }
  assert.equal(breedOf(["Skeleton", "Hollow"])?.name, "Ghost Bones");
  assert.equal(breedOf(["Colossus", "Hoverer"])?.name, "Blimp");
  assert.equal(breedOf(["Sparkling", "Mask"])?.name, "Glitter Bandit");
  assert.equal(breedOf(["Cellular", "Asymmetry"])?.name, "Wobble Blob");
  assert.equal(breedOf([]), null);
  assert.equal(breedOf(["Nope"]), null);
  assert.equal(breedOf(["Mask", "Hollow", "Family"]), null);
});

test("a baby's breed comes from its family label, and new breeds are discoveries", () => {
  assert.equal(breedOfBaby(labelled("Skeleton × Hollow"))?.name, "Ghost Bones");
  assert.equal(breedOfBaby(labelled("Hollow x Skeleton"))?.name, "Ghost Bones");
  assert.equal(breedOfBaby(labelled("Cellular × Cellular"))?.name, "Cell Division");
  const first = labelled("Skeleton × Hollow", "a");
  assert.ok(discoveriesOf(first, EMPTY_COLLECTION).includes("New breed: Ghost Bones · 1/45"));
  const before = buildCollection([first, labelled("Hollow × Skeleton", "b"), labelled("Mask × Sparkling", "c")]);
  assert.deepEqual(before.breeds, ["Ghost Bones", "Glitter Bandit"], "each breed once, in book order");
  assert.ok(!discoveriesOf(labelled("Hollow × Skeleton", "d"), before).some(line => line.startsWith("New breed")), "a known breed is not news");
  assert.ok(discoveriesOf(labelled("Colossus × Hoverer", "e"), before).includes("New breed: Blimp · 3/45"));
});

test("inherited shapes lead the reveal news, one line per parent; grown shapes are not news", () => {
  const baby: Creature = { ...labelled("Mask × Hollow", "n"), dna: { rowSource: [], pattern: new Uint8Array(256), mutations: [], traits: [], shapes: [
    { label: "Horns", kind: "head", cells: {}, from: { side: 0, name: "Zibu" } }, { label: "Tail", kind: "tail", cells: {}, from: { side: 0, name: "Zibu" } },
    { label: "Crest", kind: "head", cells: {}, from: { side: 1, name: "Momo" } }, { label: "Ears", kind: "head", cells: {} }] } };
  assert.deepEqual(inheritedNews(baby), ["Inherited: Horns and Tail from Zibu!", "Inherited: Crest from Momo!"]);
  assert.deepEqual(inheritedNews(labelled("Mask")), []);
});
