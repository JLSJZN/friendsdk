// Legacy tests (family tree, row origins, legacy share). Run from the SDK root: node --test "games/rare-breeds/tests/*.test.ts"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { breed, breedSeed, familySides, isSideWalker } from "../src/genetics.ts";
import { buildLegacy, familyLine, rowFamilies, rowOrigins, rowPath, rowSources, type CreatureLookup, type LegacyNode } from "../src/legacy.ts";
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

/**
 * A path is sound when it ends where rowOrigins does and each step's parent on the row's side is the next step (the
 * last one's is the origin); in real lines (`ordered`) the generations count down.
 */
function assertPath(baby: Creature, y: number, find: CreatureLookup = lookup, ordered = true) {
  const path = rowPath(baby, y, find)!;
  assert.equal(path.row, y);
  assert.equal(path.origin.key, rowOrigins(baby, find)[y], `${baby.name} row ${y}: same origin as rowOrigins`);
  assert.equal(path.origin.family, rowFamilies(baby, find)[y]);
  assert.equal(path.origin.tokenId, path.origin.creature?.tokenId);
  path.steps.forEach((step, k) => {
    assert.equal(step.side, step.creature.dna!.rowSource[y]);
    assert.equal(step.generation, step.creature.lineage);
    assert.equal(step.creature.parents![step.side], path.steps[k + 1]?.creature.key ?? path.origin.key);
    if (ordered && k) assert.ok(step.generation < path.steps[k - 1].generation, "generations count down");
  });
  return path;
}

test("rowPath walks a row from the baby down to the real Friend it came from", () => {
  for (const baby of [fapu, sibo, rimi, gevi, traded, late]) {
    for (let y = 0; y < 16; y++) {
      const path = assertPath(baby, y);
      assert.equal(path.steps[0].creature, baby);
      assert.equal(path.origin.creature, known.get(originOf(baby, y)), "ends at the founder the oracle finds");
      assert.equal(path.origin.creature!.lineage, 0);
      assert.equal(path.origin.family, FAMILY_NAMES[path.origin.creature!.familyId]);
      assert.equal(typeof path.origin.tokenId, "bigint");
    }
  }
  const sides = (baby: Creature, y: number) => rowPath(baby, y, lookup)!.steps.map(step => [step.creature.key, step.side, step.generation]);
  const mask = known.get(fapu.parents![1])!;
  for (let y = 0; y < 16; y++) {
    // F1: one step, straight from your Friend (parent A) or the wild mate (parent B), with its token ID and family.
    const f1 = rowPath(fapu, y, lookup)!, side = fapu.dna!.rowSource[y];
    assert.deepEqual(sides(fapu, y), [[fapu.key, side, 1]]);
    assert.deepEqual([f1.origin.creature, f1.origin.tokenId, f1.origin.family], side ? [mask, mask.tokenId, "Mask"] : [friend, friend.tokenId, "Cellular"]);
    // F2 of two kept babies: two steps, through Fapu or Sibo.
    const f2 = sides(rimi, y);
    assert.deepEqual(f2[0], [rimi.key, rimi.dna!.rowSource[y], 2]);
    assert.equal(f2.length, 2);
    assert.equal(f2[1][0], rimi.parents![rimi.dna!.rowSource[y]]);
    // F3 backcross to your Friend: its rows come straight from the Friend, the others through Rimi and an F1.
    const f3 = sides(gevi, y);
    assert.equal(f3.length, gevi.dna!.rowSource[y] ? 1 : 3);
    if (gevi.dna!.rowSource[y]) assert.equal(rowPath(gevi, y, lookup)!.origin.creature, friend);
    // A traded-in F1 still links its kept F2 to the Friend or its wild Hollow mate through the lookup.
    const late2 = sides(late, y);
    assert.equal(late2.length, late.dna!.rowSource[y] ? 1 : 2);
    if (!late.dna!.rowSource[y]) assert.equal(late2[1][0], traded.key);
    else assert.equal(rowPath(late, y, lookup)!.origin.creature!.kind, "wild");
  }
  // The Friend root (and any wild Friend) is its own origin, with no steps.
  for (const founder of [friend, mask]) {
    const path = rowPath(founder, 7, lookup)!;
    assert.deepEqual([path.steps.length, path.origin.creature, path.origin.tokenId, path.origin.family], [0, founder, founder.tokenId, founder.family]);
  }
  // Rows outside 0-15 have no path.
  for (const y of [-1, 16, 2.5, Number.NaN]) assert.equal(rowPath(fapu, y, lookup), null);
});

test("rowPath traces Side-walker babies (a Colossus in the line) through their right-facing frames", () => {
  const walker = hatch(friend, ofFamily("Colossus"), "spotted");
  const grand = hatch(ofFamily("Skeleton"), walker);
  assert.ok(isSideWalker(walker) && isSideWalker(grand), "Side-walker is dominant");
  for (const baby of [walker, grand]) {
    for (let y = 0; y < 16; y++) {
      const path = assertPath(baby, y), origin = path.origin.creature!;
      assert.equal(origin.key, originOf(baby, y));
      assert.equal(path.steps.length, baby.lineage === 2 && baby.dna!.rowSource[y] === 1 ? 2 : 1);
      // A Side-walker shows its right-facing frames from every side: its front view keeps the origin's
      // right-facing row y, walk frame by walk frame.
      for (let frame = 0; frame < 8; frame++) {
        const mine = baby.sheet.walk.down[frame], theirs = origin.sheet.walk.right[frame];
        for (let x = 0; x < 16; x++) if (theirs[y * 16 + x]) assert.equal(mine[y * 16 + x], 1, `${baby.name} row ${y} frame ${frame} pixel ${x}`);
      }
    }
  }
});

test("rowSources lists each real Friend behind a baby's rows once, most rows first", () => {
  for (const baby of [fapu, sibo, rimi, gevi, traded, late]) {
    const origins = rowOrigins(baby, lookup), sources = rowSources(baby, lookup);
    assert.deepEqual(sources.map(source => source.key).sort(), [...new Set(origins)].sort());
    assert.equal(sources.reduce((sum, source) => sum + source.rows.length, 0), 16);
    sources.forEach((source, k) => {
      assert.deepEqual(source.rows, origins.flatMap((key, y) => key === source.key ? [y] : []));
      assert.equal(source.creature, known.get(source.key));
      assert.equal(source.tokenId, source.creature!.tokenId);
      assert.equal(source.family, FAMILY_NAMES[source.creature!.familyId]);
      const before = sources[k - 1];
      if (before) assert.ok(before.rows.length > source.rows.length || (before.rows.length === source.rows.length && before.rows[0] < source.rows[0]), "most rows first");
    });
  }
  // F1: exactly its two parents with the DNA trio's row counts.
  const fromA = fapu.dna!.rowSource.filter(side => side === 0).length;
  assert.deepEqual(rowSources(fapu, lookup).map(source => [source.key, source.rows.length]).sort(),
    [[friend.key, fromA], [fapu.parents![1], 16 - fromA]].sort());
  // A Friend is its own single source.
  assert.deepEqual(rowSources(friend, lookup).map(source => [source.key, source.rows.length, source.tokenId]), [[friend.key, 16, friend.tokenId]]);
});

test("rowPath and rowSources with missing data, cycles and very deep chains never throw", () => {
  // Lost ancestors: the path ends at the parent the baby names, with the family its label gives that side.
  const alone = (key: string) => key === rimi.key ? rimi : null;
  for (let y = 0; y < 16; y++) {
    const path = assertPath(rimi, y, alone), side = rimi.dna!.rowSource[y];
    assert.deepEqual([path.steps.length, path.origin.key, path.origin.creature, path.origin.tokenId, path.origin.family],
      [1, rimi.parents![side], null, undefined, familySides(rimi.family)![side]]);
  }
  assert.deepEqual(rowSources(rimi, alone).map(source => source.key).sort(), [...new Set(rimi.parents)].sort());
  // A traded-in ancestor the lookup lost ends the path there; the other side still reaches its wild Friend.
  const lost = (key: string) => key === traded.key ? null : lookup(key);
  for (let y = 0; y < 16; y++) {
    const path = assertPath(late, y, lost);
    assert.equal(path.origin.creature === null, late.dna!.rowSource[y] === 0);
  }

  // Broken data: two babies that are each other's parents, and a baby that is its own parent.
  const loopA: Creature = Object.freeze({ ...rimi, key: "baby:loop-a", parents: ["baby:loop-b", friend.key] as const });
  const loopB: Creature = Object.freeze({ ...sibo, key: "baby:loop-b", parents: ["baby:loop-a", "baby:loop-a"] as const });
  const self: Creature = Object.freeze({ ...fapu, key: "baby:self", parents: ["baby:self", "baby:self"] as const });
  const loops = new Map([[loopA.key, loopA], [loopB.key, loopB], [self.key, self]]);
  const loopLookup = (key: string) => loops.get(key) ?? lookup(key);
  for (const baby of [loopA, loopB, self]) {
    for (let y = 0; y < 16; y++) assert.ok(assertPath(baby, y, loopLookup, false).steps.length <= 2);
    assert.equal(rowSources(baby, loopLookup).reduce((sum, source) => sum + source.rows.length, 0), 16);
  }
  assert.deepEqual(rowPath(self, 0, loopLookup)!.steps, []);
  assert.equal(rowPath(self, 0, loopLookup)!.origin.creature, self);

  // A 400 generation chain (broken data) stops at the tracer's depth limit.
  let deep: Creature = friend;
  const chain = new Map<string, Creature>();
  for (let k = 0; k < 400; k++) {
    deep = Object.freeze({ ...fapu, key: `baby:deep-${k}`, lineage: k + 1, parents: [deep.key, deep.key] as const });
    chain.set(deep.key, deep);
  }
  const deepLookup = (key: string) => chain.get(key) ?? lookup(key);
  const path = assertPath(deep, 0, deepLookup);
  assert.ok(path.steps.length > 0 && path.steps.length <= 256);
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
