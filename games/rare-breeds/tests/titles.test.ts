// Lineage title tests (Echo, Purebred, Chimera). Run from the SDK root: node --test "games/rare-breeds/tests/*.test.ts"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { breed, breedSeed } from "../src/genetics.ts";
import { creatureFromRecord, FAMILY_NAMES, type WildFriendRecord } from "../src/sprites.ts";
import { CHIMERA_FRIENDS, ECHO_ROWS, lineageTitles, TITLE_ORDER } from "../src/titles.ts";
import { buildCollection, discoveriesOf, EMPTY_COLLECTION } from "../src/ui/collection.ts";
import type { Creature } from "../src/types.ts";

const records: WildFriendRecord[] = JSON.parse(readFileSync(new URL("../data/wild-friends.json", import.meta.url), "utf8")).friends;
const friend = creatureFromRecord(records.find(record => record.id === "77949")!, "friend"); // Cellular
const wild = records.filter(record => record.id !== "77949").map(record => creatureFromRecord(record));
const ofFamily = (name: string, index = 0) => wild.filter(creature => creature.family === name)[index];
const known = new Map<string, Creature>([[friend.key, friend], ...wild.map(creature => [creature.key, creature] as const)]);
const lookup = (key: string) => known.get(key) ?? null;
const ids = (baby: Creature, withFriend: Creature | null = friend) => lineageTitles(baby, lookup, withFriend).map(title => title.id);

/** A constructed baby: only its parents and row sources matter to titles (the pixels are borrowed). */
function baby(key: string, a: Creature, b: Creature, rows: string): Creature {
  const side = (parent: Creature) => parent.kind === "baby" ? parent.family.split(" × ")[0] : FAMILY_NAMES[parent.familyId];
  const creature: Creature = Object.freeze({
    key, kind: "baby", name: key, family: `${side(a)} × ${side(b)}`, familyId: a.familyId, lineage: Math.max(a.lineage, b.lineage) + 1,
    sheet: friend.sheet, tier: "common", parents: [a.key, b.key] as const,
    dna: Object.freeze({ rowSource: Object.freeze([...rows].map(Number) as (0 | 1)[]), pattern: new Uint8Array(256), mutations: [], traits: [] }),
  });
  known.set(key, creature);
  return creature;
}

test(`Echo of #id needs at least ${ECHO_ROWS} of 16 rows from the player's own Friend`, () => {
  const mask = ofFamily("Mask");
  const echo = baby("baby:e12", friend, mask, "0000011000000011");
  assert.deepEqual(lineageTitles(echo, lookup, friend).map(title => title.label), ["Echo of #77949"]);
  assert.deepEqual(ids(baby("baby:e11", friend, mask, "0000111000000011")), [], "11 rows are not enough");
  assert.deepEqual(ids(echo, null), [], "no Friend given, no Echo");
  // Through generations: a backcross F2 (Friend as parent A again) collects the Friend's rows from both sides.
  const f1 = baby("baby:f1", friend, mask, "0000111100001111");
  assert.deepEqual(ids(baby("baby:back", friend, f1, "1111001100000011")), ["echo"]);
});

test("Purebred <Family> needs all 16 rows from one family", () => {
  const cellular = ofFamily("Cellular");
  assert.deepEqual(lineageTitles(baby("baby:p1", friend, cellular, "0000111100001111"), lookup, friend).map(title => title.label), ["Purebred Cellular"]);
  assert.deepEqual(ids(baby("baby:p2", ofFamily("Hollow"), ofFamily("Hollow", 1), "0011001100110011")), ["purebred"], "any family, no Friend needed");
  assert.deepEqual(ids(baby("baby:p3", friend, ofFamily("Mask"), "0000111100001111")), [], "a mixed line is not purebred");
  // Real genetics: every Friend x same-family wild F1 is purebred.
  for (const mate of wild.filter(creature => creature.family === "Cellular")) {
    const playId = 700n + BigInt(mate.tokenId! % 97n), result = breed({ a: friend, b: mate, tier: "common", playId, seed: breedSeed(77949n, friend.key, mate.key, playId) });
    const real: Creature = { key: `baby:real${mate.tokenId}`, kind: "baby", name: result.name, family: result.family, familyId: result.familyId,
      lineage: 1, sheet: result.sheet, tier: "common", parents: [friend.key, mate.key], dna: result.dna };
    assert.ok(ids(real).includes("purebred"), `${real.family} is purebred`);
  }
});

test(`Chimera needs rows from at least ${CHIMERA_FRIENDS} distinct real Friends`, () => {
  const f1a = baby("baby:c1", friend, ofFamily("Mask"), "0000111100001111");
  const f1b = baby("baby:c2", ofFamily("Hollow"), ofFamily("Sparkling"), "0000111100001111");
  // Rows alternate F1a / F1b in pairs: Friend, Hollow, Mask, Sparkling rows all survive.
  assert.deepEqual(lineageTitles(baby("baby:c3", f1a, f1b, "0011001100110011"), lookup, friend).map(title => title.label), ["Chimera"]);
  // Only three founders survive when F1b gives only its Hollow rows.
  assert.deepEqual(ids(baby("baby:c4", f1a, f1b, "0011000000110000")), []);
});

test("titles stack in a fixed order, and only babies earn them", () => {
  const cellular = [ofFamily("Cellular"), ofFamily("Cellular", 1), ofFamily("Cellular", 2)];
  // Echo and Purebred together: 12 Friend rows and a Cellular mate.
  assert.deepEqual(ids(baby("baby:s1", friend, cellular[0], "0000011000000011")), ["echo", "purebred"]);
  // Purebred and Chimera together: four Cellular Friends.
  const left = baby("baby:s2", friend, cellular[0], "0000111100001111"), right = baby("baby:s3", cellular[1], cellular[2], "0000111100001111");
  assert.deepEqual(ids(baby("baby:s4", left, right, "0011001100110011")), ["purebred", "chimera"]);
  assert.deepEqual([...TITLE_ORDER], ["echo", "purebred", "chimera", "dreamchild"]);
  assert.deepEqual(ids(friend), []);
  assert.deepEqual(ids(ofFamily("Mask")), []);
  // An unknown ancestor still counts as the origin of its rows (legacy.ts): a missing Mask parent keeps the line mixed.
  const orphan: Creature = { ...baby("baby:s5", friend, ofFamily("Mask"), "0000111100001111"), parents: [friend.key, "wild:unknown"] };
  assert.deepEqual(ids(orphan), []);
});

test("a first title adds a discovery line, once", () => {
  const f1a = baby("baby:d1", friend, ofFamily("Mask"), "0000111100001111");
  const f1b = baby("baby:d2", ofFamily("Hollow"), ofFamily("Sparkling"), "0000111100001111");
  const chimera = baby("baby:d3", f1a, f1b, "0011001100110011");
  const titles = lineageTitles(chimera, lookup, friend);
  assert.ok(discoveriesOf(chimera, EMPTY_COLLECTION, titles).includes("First Chimera: rows from 4 different Friends, just for show"), "the first title explains itself");
  const before = buildCollection([f1a, f1b, chimera], [], creature => lineageTitles(creature, lookup, friend));
  assert.deepEqual(before.titles, ["chimera"]);
  assert.ok(!discoveriesOf(chimera, before, titles).some(line => line.startsWith("First Chimera")));
  // Titles never touch value: the collection counts tiers from hatches only.
  assert.deepEqual(before.tiers, ["common"]);
});
