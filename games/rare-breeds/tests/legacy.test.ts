// Legacy tests (family tree, row origins, legacy share). Run from the SDK root: node --test "games/rare-breeds/tests/*.test.ts"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { breed, breedSeed } from "../src/genetics.ts";
import { buildLegacy, familyLine, rowFamilies, rowOrigins, type LegacyNode } from "../src/legacy.ts";
import { creatureFromRecord, FAMILY_NAMES, type WildFriendRecord } from "../src/sprites.ts";
import { TIER_ORDER, type Creature, type TierId } from "../src/types.ts";

const records: WildFriendRecord[] = JSON.parse(readFileSync(new URL("../data/wild-friends.json", import.meta.url), "utf8")).friends;
const friend = creatureFromRecord(records.find(record => record.id === "77949")!, "friend");
const wild = records.filter(record => record.id !== "77949").map(record => creatureFromRecord(record));
const ofFamily = (name: string, index = 0) => wild.filter(creature => creature.family === name)[index];

/** Every creature ever made in these tests, like the controller's lineage map. */
const known = new Map<string, Creature>([[friend.key, friend], ...wild.map(creature => [creature.key, creature] as const)]);
const lookup = (key: string) => known.get(key) ?? null;
let plays = 0n;
function hatch(a: Creature, b: Creature, tier: TierId = "common"): Creature {
  const playId = ++plays, result = breed({ a, b, tier, playId, seed: breedSeed(friend.tokenId!, a.key, b.key, playId) });
  const baby: Creature = Object.freeze({
    key: `baby:${playId}`, kind: "baby", name: result.name, family: result.family, familyId: result.familyId, lineage: result.lineage,
    sheet: result.sheet, tier, parents: [a.key, b.key] as const, dna: result.dna, playId,
  });
  known.set(baby.key, baby);
  return baby;
}

// Independent oracle: follow rowSource one row at a time.
function originOf(creature: Creature, y: number): string {
  let at = creature;
  while (at.dna && at.parents) at = known.get(at.parents[at.dna.rowSource[y]])!;
  return at.key;
}
const allNodes = (node: LegacyNode): LegacyNode[] => [node, ...node.children.flatMap(allNodes)];
const shape = (node: LegacyNode): unknown => [node.creature.key, node.role, node.mate?.key ?? null, node.friendRows, node.children.map(shape)];

// A small family: Cellular Friend x Mask and x Sparkling (F1), their F2, an F3 backcross to the Friend,
// and a Hollow F1 that was traded in but left a kept F2 with a Hoverer mate.
const fapu = hatch(friend, ofFamily("Mask"), "spotted");
const sibo = hatch(friend, ofFamily("Sparkling"));
const rimi = hatch(fapu, sibo, "mutant");
const gevi = hatch(rimi, friend);
const traded = hatch(friend, ofFamily("Hollow"));
const late = hatch(traded, ofFamily("Hoverer"), "prismatic");
const brood = [fapu, sibo, rimi, gevi, late];

test("rowOrigins follows rowSource to the Friend or wild Friend whose row it really is", () => {
  for (const baby of [fapu, sibo, rimi, gevi, traded, late]) {
    const origins = rowOrigins(baby, lookup);
    assert.equal(origins.length, 16);
    origins.forEach((key, y) => {
      assert.equal(key, originOf(baby, y), `${baby.name} row ${y}`);
      const origin = known.get(key)!;
      assert.equal(origin.lineage, 0, "origins are founders");
      // The origin's ink in that row is still there in the baby (repairs and mutations only ever add pixels).
      const mine = baby.sheet.idle.right[0], theirs = origin.sheet.idle.right[0];
      for (let x = 0; x < 16; x++) if (theirs[y * 16 + x]) assert.equal(mine[y * 16 + x], 1, `${baby.name} keeps ${key} row ${y} pixel ${x}`);
    });
  }
  // F1: the origin is simply the parent the row came from.
  assert.deepEqual(rowOrigins(fapu, lookup), fapu.dna!.rowSource.map(side => fapu.parents![side]));
  // A Friend owns all its rows; rowFamilies names the origin's family.
  assert.deepEqual(rowOrigins(friend, lookup), Array(16).fill(friend.key));
  assert.deepEqual(rowFamilies(gevi, lookup), rowOrigins(gevi, lookup).map(key => FAMILY_NAMES[known.get(key)!.familyId]));
});

test("familyLine lists every family of the lineage once, in the order it was mixed in", () => {
  assert.deepEqual(familyLine(friend, lookup), ["Cellular"]);
  assert.deepEqual(familyLine(fapu, lookup), ["Cellular", "Mask"]);
  assert.deepEqual(familyLine(rimi, lookup), ["Cellular", "Mask", "Sparkling"]);
  assert.deepEqual(familyLine(gevi, lookup), ["Cellular", "Mask", "Sparkling"]);
  assert.deepEqual(familyLine(late, lookup), ["Cellular", "Hollow", "Hoverer"]);
  // The F2 label is a clean two-name summary of that line (the judge's "Cellular × Cellular" case).
  assert.equal(rimi.family, "Mask × Sparkling");
  // Without ancestors, the label's side names stand in.
  assert.deepEqual(familyLine(rimi, () => null), ["Mask", "Sparkling"]);
});

test("buildLegacy: tree, descendants, families and legacy share", () => {
  const legacy = buildLegacy(friend, brood, lookup);
  assert.equal(legacy.descendants, 5);
  assert.equal(legacy.deepestLineage, 3);
  assert.deepEqual(legacy.families, ["Cellular", "Mask", "Sparkling", "Hollow", "Hoverer"]);

  const tree = legacy.tree;
  assert.equal(tree.creature, friend);
  assert.equal(tree.role, "friend");
  assert.equal(tree.friendRows, 16);
  // Friend -> Fapu -> Rimi (mate Sibo, both kept) -> Gevi (mate: the Friend); Sibo; the traded Hollow F1 -> its kept F2.
  assert.deepEqual(shape(tree), [friend.key, "friend", null, 16, [
    [fapu.key, "kept", fapu.parents![1], rowOrigins(fapu, lookup).filter(key => key === friend.key).length, [
      [rimi.key, "kept", sibo.key, rowOrigins(rimi, lookup).filter(key => key === friend.key).length, [
        [gevi.key, "kept", friend.key, rowOrigins(gevi, lookup).filter(key => key === friend.key).length, []],
      ]],
    ]],
    [sibo.key, "kept", sibo.parents![1], rowOrigins(sibo, lookup).filter(key => key === friend.key).length, []],
    [traded.key, "ancestor", traded.parents![1], rowOrigins(traded, lookup).filter(key => key === friend.key).length, [
      [late.key, "kept", late.parents![1], rowOrigins(late, lookup).filter(key => key === friend.key).length, []],
    ]],
  ]]);
  const kept = allNodes(tree).filter(node => node.role === "kept").map(node => node.creature.key);
  assert.deepEqual([...kept].sort(), brood.map(baby => baby.key).sort(), "every kept baby appears exactly once");

  const friendRows = brood.reduce((sum, baby) => sum + rowOrigins(baby, lookup).filter(key => key === friend.key).length, 0);
  assert.equal(legacy.friendRows, friendRows);
  assert.equal(legacy.totalRows, 16 * brood.length);
  assert.equal(legacy.legacyShare, friendRows / (16 * brood.length));
  assert.ok(legacy.legacyShare > 0 && legacy.legacyShare < 1);
});

test("buildLegacy is deterministic, ignores brood order and duplicates, and prefers brood objects", () => {
  const first = buildLegacy(friend, brood, lookup);
  const shuffled = buildLegacy(friend, [late, gevi, sibo, fapu, rimi, sibo], lookup);
  assert.deepEqual(shape(shuffled.tree), shape(first.tree));
  assert.deepEqual([shuffled.descendants, shuffled.families, shuffled.legacyShare], [first.descendants, first.families, first.legacyShare]);
  // A dressed brood object (same key, new accessory) is the one the tree shows.
  const dressed = Object.freeze({ ...sibo, accessory: "crown" as const });
  const node = buildLegacy(friend, [fapu, dressed, rimi], lookup).tree.children.find(child => child.creature.key === sibo.key)!;
  assert.equal(node.creature, dressed);
});

test("buildLegacy with an empty brood, and with unknown or cyclic ancestry, never throws", () => {
  const empty = buildLegacy(friend, [], lookup);
  assert.deepEqual([empty.descendants, empty.deepestLineage, empty.families, empty.legacyShare, empty.tree.children.length], [0, 0, ["Cellular"], 0, 0]);

  // Lost ancestors: the baby cannot be placed in the tree but its rows still count.
  const orphan = buildLegacy(friend, [rimi], key => key === rimi.key ? rimi : null);
  assert.equal(orphan.descendants, 0);
  assert.equal(orphan.totalRows, 16);
  assert.equal(orphan.legacyShare, 0);

  // Broken data: two babies that are each other's parents, one of them also a child of the Friend.
  const loopA: Creature = Object.freeze({ ...rimi, key: "baby:loop-a", parents: ["baby:loop-b", friend.key] as const });
  const loopB: Creature = Object.freeze({ ...sibo, key: "baby:loop-b", parents: ["baby:loop-a", "baby:loop-a"] as const });
  const loops = new Map([[loopA.key, loopA], [loopB.key, loopB]]);
  const loopLookup = (key: string) => loops.get(key) ?? lookup(key);
  const legacy = buildLegacy(friend, [loopA, loopB], loopLookup);
  assert.ok(legacy.descendants >= 1);
  assert.ok(allNodes(legacy.tree).length <= 3);
  assert.equal(rowOrigins(loopB, loopLookup).length, 16);
  assert.ok(familyLine(loopA, loopLookup).includes("Cellular"));
});

test("buildLegacy is fast on a big brood (well under 5 ms)", () => {
  const big: Creature[] = [];
  let generation: Creature[] = [friend];
  for (let depth = 0; depth < 6; depth++) {
    const next: Creature[] = [];
    for (let k = 0; k < 10; k++) {
      const a = generation[k % generation.length], b = k % 2 ? wild[(depth * 10 + k) % wild.length] : big[(k * 7) % Math.max(1, big.length)] ?? wild[k];
      next.push(hatch(a, b, TIER_ORDER[k % 4]));
    }
    big.push(...next);
    generation = next;
  }
  const start = performance.now();
  for (let k = 0; k < 20; k++) buildLegacy(friend, big, lookup);
  const average = (performance.now() - start) / 20;
  const legacy = buildLegacy(friend, big, lookup);
  assert.equal(legacy.descendants, big.length);
  assert.equal(legacy.deepestLineage, Math.max(...big.map(baby => baby.lineage)));
  assert.ok(average < 5, `average ${average.toFixed(2)} ms for ${big.length} babies`);
});
