// Genetics tests. Run from the SDK root: node --test "games/rare-breeds/tests/*.test.ts"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { breed, breedSeed, inheritedShapes, passableShapes, PASS_ON_ODDS } from "../src/genetics.ts";
import { babyName, isBlockedName } from "../src/names.ts";
import { COLOSSUS, creatureFromRecord, FAMILY_NAMES, type WildFriendRecord } from "../src/sprites.ts";
import { FACING_FRAMES, FACINGS, TIER_ORDER, type BreedResult, type Creature, type Facing, type Frame, type ShapeTrait, type TierId } from "../src/types.ts";

const records: WildFriendRecord[] = JSON.parse(readFileSync(new URL("../data/wild-friends.json", import.meta.url), "utf8")).friends;
const pool = records.map(record => creatureFromRecord(record));
const pinned = pool.find(creature => creature.tokenId === 77949n)!;
const CLIPS = ["idle", "walk"] as const;

// Independent helpers (deliberately not shared with the module under test).
const ink = (frame: Frame) => frame.reduce((sum, value) => sum + value, 0);
const mirrorOf = (i: number) => (i >> 4) * 16 + 15 - (i & 15);
const symmetric = (frame: ArrayLike<number>) => Array.from({ length: 256 }, (_, i) => i).every(i => frame[i] === frame[mirrorOf(i)]);
const same = (a: Frame, b: Frame) => a.every((value, i) => value === b[i]);
function parts(frame: Frame): number {
  const seen = new Uint8Array(256);
  let count = 0;
  for (let start = 0; start < 256; start++) if (frame[start] && !seen[start]) {
    count++;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const cell = stack.pop()!, x = cell & 15, y = cell >> 4;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * 16 + nx;
        if (nx >= 0 && ny >= 0 && nx < 16 && ny < 16 && frame[next] && !seen[next]) { seen[next] = 1; stack.push(next); }
      }
    }
  }
  return count;
}
const frames = (creature: { sheet: Creature["sheet"] }) => CLIPS.flatMap(clip => FACINGS.flatMap(facing => creature.sheet[clip][facing]));
const sideWalkerArt = (creature: { sheet: Creature["sheet"] }) =>
  CLIPS.every(clip => creature.sheet[clip].down.every((frame, i) => same(frame, creature.sheet[clip].right[i])));

let state = 0x2545f491;
const random = (n: number) => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state % n; };
const randomPair = (): [Creature, Creature] => {
  const a = pool[random(pool.length)];
  let b = pool[random(pool.length)];
  while (b === a) b = pool[random(pool.length)];
  return [a, b];
};

let plays = 0n;
function hatch(a: Creature, b: Creature, tier: TierId, playId = ++plays): { result: BreedResult; baby: Creature } {
  const seed = breedSeed(77949n, a.key, b.key, playId);
  const result = breed({ a, b, seed, tier, playId });
  const baby: Creature = Object.freeze({
    key: `baby:${playId}`, kind: "baby", name: result.name, family: result.family, familyId: result.familyId, lineage: result.lineage,
    sheet: result.sheet, tier, parents: [a.key, b.key] as const, dna: result.dna, playId,
  });
  return { result, baby };
}

function assertHealthy(result: BreedResult, label: string) {
  for (const clip of CLIPS) for (const facing of FACINGS) {
    const list = result.sheet[clip][facing];
    assert.equal(list.length, 8, `${label}: ${clip} ${facing} has 8 frames`);
    list.forEach((frame, i) => {
      assert.equal(frame.length, 256, `${label}: frame size`);
      assert.ok(frame.every(value => value === 0 || value === 1), `${label}: one-bit frame`);
      assert.ok(ink(frame) >= 12, `${label}: ${clip} ${facing} ${i} has ink (${ink(frame)})`);
      assert.equal(parts(frame), 1, `${label}: ${clip} ${facing} ${i} is one 8-connected body`);
    });
  }
  assert.equal(result.dna.pattern.length, 256, `${label}: pattern is a 256 stencil`);
}

test("breedSeed is a stable unsigned 32-bit hash of all inputs", () => {
  const seed = breedSeed(77949n, "friend:77949", "wild:117713", 12n);
  assert.equal(seed, breedSeed(77949n, "friend:77949", "wild:117713", 12n));
  assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff);
  const variants = [breedSeed(77948n, "friend:77949", "wild:117713", 12n), breedSeed(77949n, "friend:77949", "wild:117714", 12n),
    breedSeed(77949n, "wild:117713", "friend:77949", 12n), breedSeed(77949n, "friend:77949", "wild:117713", 13n)];
  assert.equal(new Set([seed, ...variants]).size, 5);
});

test("breed is deterministic for the same input", () => {
  for (const tier of TIER_ORDER) for (let k = 0; k < 10; k++) {
    const [a, b] = randomPair();
    const seed = breedSeed(1n, a.key, b.key, BigInt(k)), input = { a, b, seed, tier, playId: BigInt(k) };
    const first = breed(input), second = breed(input);
    assert.deepEqual(frames(first).map(frame => Array.from(frame)), frames(second).map(frame => Array.from(frame)));
    assert.deepEqual(Array.from(first.dna.pattern), Array.from(second.dna.pattern));
    assert.deepEqual([first.dna.rowSource, first.dna.mutations, first.dna.traits], [second.dna.rowSource, second.dna.mutations, second.dna.traits]);
    assert.deepEqual([first.name, first.family, first.familyId, first.lineage], [second.name, second.family, second.familyId, second.lineage]);
  }
});

test("every frame of 500 random pairs x 4 tiers is one non-empty 8-connected body", () => {
  for (let k = 0; k < 500; k++) {
    const [a, b] = randomPair();
    for (const tier of TIER_ORDER) assertHealthy(hatch(a, b, tier).result, `${a.name} x ${b.name} ${tier}`);
  }
});

test("row inheritance, family and lineage follow the rules", () => {
  for (let k = 0; k < 300; k++) {
    const [a, b] = randomPair();
    const { result } = hatch(a, b, TIER_ORDER[k % 4]);
    const rows = result.dna.rowSource;
    assert.equal(rows.length, 16);
    assert.ok(rows.every(row => row === 0 || row === 1));
    const runs: number[] = [];
    rows.forEach((row, y) => { if (y && row === rows[y - 1]) runs[runs.length - 1]++; else runs.push(1); });
    assert.ok(runs.every(run => run >= 2 && run <= 5), `segments of 2-5 rows: ${rows.join("")}`);
    const fromB = rows.filter(row => row === 1).length;
    assert.ok(fromB >= 3 && 16 - fromB >= 3, "both parents give at least 3 rows");
    assert.equal(result.familyId, fromB > 8 ? b.familyId : a.familyId);
    assert.equal(result.family, `${FAMILY_NAMES[a.familyId]} × ${FAMILY_NAMES[b.familyId]}`);
    assert.equal(result.lineage, 1);
    assert.match(result.name, /^[A-Z][a-z]{3}$/);
  }
});

test("row sources are real: baby rows match the parent row outside repairs and mutations", () => {
  for (let k = 0; k < 100; k++) {
    const [a, b] = randomPair();
    const { result } = hatch(a, b, "common");
    const down = result.sheet.idle.right[0], fa = a.sheet.idle.right[0], fb = b.sheet.idle.right[0];
    let kept = 0, total = 0;
    for (let i = 0; i < 256; i++) {
      const parent = result.dna.rowSource[i >> 4] ? fb : fa;
      if (parent[i]) { total++; kept += down[i]; }
    }
    assert.equal(kept, total, "no inherited pixel is ever removed");
  }
});

test("symmetric parents give symmetric front and back views, mutations and pattern", () => {
  const symmetricPool = pool.filter(c => c.familyId !== COLOSSUS && symmetric(c.sheet.idle.down[0]) && symmetric(c.sheet.idle.up[0]));
  assert.ok(symmetricPool.length > 20);
  let checkedFrames = 0;
  for (let k = 0; k < 150; k++) {
    const a = symmetricPool[random(symmetricPool.length)], b = symmetricPool[(random(symmetricPool.length - 1) + symmetricPool.indexOf(a) + 1) % symmetricPool.length];
    for (const tier of TIER_ORDER) {
      const { result } = hatch(a, b, tier);
      assert.ok(symmetric(result.dna.pattern), "pattern stencil is symmetric");
      for (const clip of CLIPS) for (const facing of ["down", "up"] as const) result.sheet[clip][facing].forEach((frame, i) => {
        if (!symmetric(a.sheet[clip][facing][i]) || !symmetric(b.sheet[clip][facing][i])) return;
        assert.ok(symmetric(frame), `${a.name} x ${b.name} ${tier} ${clip} ${facing} ${i} stays symmetric`);
        checkedFrames++;
      });
      const cells = new Set(result.dna.mutations);
      assert.ok(result.dna.mutations.every(cell => cells.has(mirrorOf(cell))), "mutation cells are mirrored");
    }
  }
  assert.ok(checkedFrames > 1000);
});

test("Side-walker: Colossus art is dominant and inherited through generations", () => {
  const colossi = pool.filter(c => c.familyId === COLOSSUS), others = pool.filter(c => c.familyId !== COLOSSUS);
  for (let k = 0; k < 60; k++) {
    const colossus = colossi[random(colossi.length)], other = others[random(others.length)];
    const [a, b] = k % 2 ? [colossus, other] : [other, colossus];
    const { result, baby } = hatch(a, b, TIER_ORDER[k % 4]);
    assert.ok(result.dna.traits.includes("Side-walker"));
    assert.ok(sideWalkerArt(baby), "down and up reuse the baby's own right-facing frames");
    for (const clip of CLIPS) result.sheet[clip].up.forEach((frame, i) => assert.ok(same(frame, result.sheet[clip].right[i])));
    const grandchild = hatch(baby, others[random(others.length)], "common").result;
    assert.ok(grandchild.dna.traits.includes("Side-walker"), "the gene is dominant in F2");
    assert.ok(sideWalkerArt({ sheet: grandchild.sheet }));
  }
  for (let k = 0; k < 60; k++) {
    const a = others[random(others.length)], b = others[random(others.length)];
    if (a === b) continue;
    const { result } = hatch(a, b, "common");
    assert.ok(!result.dna.traits.includes("Side-walker"));
    assert.ok(!sideWalkerArt({ sheet: result.sheet }), "front art is kept");
  }
});

test("tier effects: pattern, mutations and traits", () => {
  const PATTERNS = ["Spots", "Stripes", "Patch"];
  const HEADS = ["Antennae", "Horns", "Ears", "Crest", "Long Antennae", "Big Horns", "Bunny Ears", "Mohawk"];
  const coverage = (result: BreedResult) => {
    const frame = result.sheet.idle.down[0];
    let total = 0, hit = 0;
    for (let i = 0; i < 256; i++) if (frame[i]) { total++; hit += result.dna.pattern[i]; }
    return hit / total;
  };
  for (let k = 0; k < 200; k++) {
    const [a, b] = randomPair();
    const common = hatch(a, b, "common").result;
    assert.equal(ink(common.dna.pattern), 0, "common has an empty pattern");
    assert.deepEqual(common.dna.mutations, []);
    assert.ok(common.dna.traits.every(trait => trait === "Side-walker"));

    const spotted = hatch(a, b, "spotted").result;
    const spottedTraits = spotted.dna.traits.filter(trait => trait !== "Side-walker");
    assert.equal(spottedTraits.length, 1);
    assert.ok(PATTERNS.includes(spottedTraits[0]), `spotted trait ${spottedTraits[0]}`);
    assert.deepEqual(spotted.dna.mutations, []);
    const spottedCover = coverage(spotted);
    assert.ok(spottedCover > 0.03 && spottedCover < 0.6, `readable spotted coverage ${spottedCover.toFixed(2)}`);

    const mutant = hatch(a, b, "mutant").result;
    const mutantTraits = mutant.dna.traits.filter(trait => trait !== "Side-walker");
    assert.ok(HEADS.includes(mutantTraits[0]) || mutantTraits[0] === "Tail", `mutant shape trait ${mutantTraits[0]}`);
    assert.ok(PATTERNS.includes(mutantTraits.at(-1)!), "mutant pattern trait");
    assert.ok(mutant.dna.mutations.length >= 2, `${a.name} x ${b.name} mutant grows cells`);
    assert.ok(mutant.dna.mutations.every(cell => mutant.sheet.idle.down[0][cell] === 1), "mutation cells are ink");
    assert.ok(coverage(mutant) > 0.03);

    const prismatic = hatch(a, b, "prismatic").result;
    assert.ok(prismatic.dna.traits.includes("Rainbow"));
    assert.ok(prismatic.dna.mutations.length >= 2);
    assert.ok(coverage(prismatic) >= 0.6, `prismatic covers most ink (${coverage(prismatic).toFixed(2)})`);
  }
});

test("F2 and F3 babies breed like wild Friends", () => {
  for (let k = 0; k < 60; k++) {
    const [a, b] = randomPair(), [c, d] = randomPair();
    const left = hatch(a, b, TIER_ORDER[k % 4]).baby, right = hatch(c, d, TIER_ORDER[(k + 1) % 4]).baby;
    const f2 = hatch(left, right, TIER_ORDER[(k + 2) % 4]);
    assert.equal(f2.result.lineage, 2);
    assertHealthy(f2.result, `F2 ${k}`);
    const founders = new Set<string>([a, b, c, d].map(creature => FAMILY_NAMES[creature.familyId]));
    const sides = labelSides(f2.result.family);
    assert.ok(sides.every(name => founders.has(name)), `F2 label ${f2.result.family} names grandparent families`);
    const f3 = hatch(f2.baby, k % 2 ? pinned : left, TIER_ORDER[(k + 3) % 4]);
    assert.equal(f3.result.lineage, 3);
    assertHealthy(f3.result, `F3 ${k}`);
    founders.add(FAMILY_NAMES[pinned.familyId]);
    assert.ok(labelSides(f3.result.family).every(name => founders.has(name)), `F3 label ${f3.result.family} names lineage families`);
  }
});

// Family labels. Oracle helpers trace F2 rows by hand: baby row y is row y of parent rowSource[y].
const labelSides = (label: string) => {
  const parts = label.split(" × ");
  assert.equal(parts.length, 2, `two-name label: ${label}`);
  assert.ok(parts.every(name => (FAMILY_NAMES as readonly string[]).includes(name)), `known families: ${label}`);
  return parts;
};
/** Family of row y of an F0 or F1 creature, traced through its parents (exact for F1). */
const rowFamily = (creature: Creature, parents: readonly Creature[] | null, y: number) =>
  parents ? FAMILY_NAMES[parents[creature.dna!.rowSource[y]].familyId] : FAMILY_NAMES[creature.familyId];
const rowHasInk = (frame: Frame, y: number) => frame.subarray(y * 16, y * 16 + 16).some(Boolean);

test("F2 labels name the family line each side passes on, never 'Cellular × Cellular' for a mixed line", () => {
  // The judge case: two babies of one Cellular Friend, with a Mask and a Sparkling mate.
  const mask = pool.find(c => c.familyId === 1 && c !== pinned)!, sparkling = pool.find(c => c.familyId === 7 && c !== pinned)!;
  const fapu = hatch(pinned, mask, "common", 1n).baby, sibo = hatch(pinned, sparkling, "common", 2n).baby;
  assert.equal(fapu.family, "Cellular × Mask");
  assert.equal(sibo.family, "Cellular × Sparkling");
  assert.equal(hatch(fapu, sibo, "common", 3n).baby.family, "Mask × Sparkling");

  // Property check over many F2s bred the way the game does (every baby descends from the player's Friend).
  const friendLine = pool.filter(c => c !== pinned);
  let mixed = 0;
  for (let k = 0; k < 400; k++) {
    const mates = [friendLine[random(friendLine.length)], friendLine[random(friendLine.length)]];
    const f1 = mates.map(mate => hatch(pinned, mate, TIER_ORDER[k % 4]).baby);
    // Parent B is a sibling, a wild Friend or the Friend itself (backcross).
    const [partner, partnerParents] = k % 3 === 0 ? [f1[1], [pinned, mates[1]]] as const : k % 3 === 1 ? [mates[1], null] as const : [pinned, null] as const;
    const parents = [[f1[0], [pinned, mates[0]]], [partner, partnerParents]] as const;
    const { result } = hatch(f1[0], partner, TIER_ORDER[(k + 1) % 4]);
    const names = labelSides(result.family);
    const view = result.dna.traits.includes("Side-walker") ? "right" : "down";
    // Families each side really passes on (rows with ink in that parent's main frame, all its rows if none).
    const carried = parents.map(([parent, grand], side) => {
      const mine = result.dna.rowSource.map((source, y) => source === side ? y : -1).filter(y => y >= 0);
      const inked = mine.filter(y => rowHasInk(parent.sheet.idle[view][0], y));
      return new Set<string>((inked.length ? inked : mine).map(y => rowFamily(parent, grand, y)));
    });
    names.forEach((name, side) => assert.ok(carried[side].has(name), `${result.family}: side ${side} passes on ${name} (${[...carried[side]]})`));
    if (new Set([...carried[0], ...carried[1]]).size >= 2) {
      mixed++;
      assert.notEqual(names[0], names[1], `${result.family} hides a family the line carries`);
    }
  }
  assert.ok(mixed > 250, `most sampled lines are mixed (${mixed})`);
});

test("degenerate parents never crash and never give empty or broken frames", () => {
  const blank = () => new Uint8Array(256);
  const dot = () => { const frame = blank(); frame[7 * 16 + 7] = 1; return frame; };
  const sheetOf = (make: () => Uint8Array) => Object.freeze({
    idle: Object.freeze({ down: [make(), make(), make(), make(), make(), make(), make(), make()], up: Array.from({ length: 8 }, make), left: Array.from({ length: 8 }, make), right: Array.from({ length: 8 }, make) }),
    walk: Object.freeze({ down: Array.from({ length: 8 }, make), up: Array.from({ length: 8 }, make), left: Array.from({ length: 8 }, make), right: Array.from({ length: 8 }, make) }),
  });
  const odd = (key: string, make: () => Uint8Array): Creature =>
    Object.freeze({ key, kind: "wild", name: key, family: "Cellular", familyId: 3, lineage: 0, sheet: sheetOf(make) });
  const cases: [Creature, Creature][] = [[pinned, pinned], [odd("wild:dot", dot), pinned], [odd("wild:blank", blank), odd("wild:dot", dot)], [odd("wild:blank", blank), odd("wild:blank2", blank)]];
  for (const [a, b] of cases) for (const tier of TIER_ORDER) {
    const { result } = hatch(a, b, tier);
    for (const frame of frames(result)) {
      assert.ok(ink(frame) > 0, `${a.key} x ${b.key} ${tier}: never empty`);
      assert.equal(parts(frame), 1, `${a.key} x ${b.key} ${tier}: one body`);
    }
  }
});

test("breeding is fast (average well under 5 ms)", () => {
  const pairs = Array.from({ length: 200 }, randomPair);
  const start = performance.now();
  pairs.forEach(([a, b], k) => breed({ a, b, seed: breedSeed(3n, a.key, b.key, BigInt(k)), tier: TIER_ORDER[k % 4], playId: BigInt(k) }));
  const average = (performance.now() - start) / pairs.length;
  assert.ok(average < 5, `average ${average.toFixed(2)} ms`);
});

test("baby names are cute, capitalised, deterministic and clean", () => {
  const names = new Set<string>();
  for (let seed = 0; seed < 20000; seed++) {
    const name = babyName(seed * 2654435761);
    assert.equal(name, babyName(seed * 2654435761));
    assert.match(name, /^[A-Z][a-z]{3}$/);
    assert.match(name.toLowerCase(), /^[bdfgklmnprstvz][aeiou][bdfgklmnprstvxz][aeiou]$/);
    assert.ok(!isBlockedName(name), name);
    for (const word of ["nig", "fag", "kike", "rape", "nazi", "pedo", "homo", "paki", "puta", "dago", "kaka", "tit"]) assert.ok(!name.toLowerCase().includes(word), name);
    assert.ok(name !== "Name" && name !== "None", "no name that reads like placeholder text");
    names.add(name);
  }
  assert.ok(names.size > 1500, `variety: ${names.size} names`);
});

test("a name already used this session is re-rolled, deterministically, and changes nothing else", () => {
  for (let k = 0; k < 60; k++) {
    const [a, b] = randomPair(), playId = BigInt(900 + k), seed = breedSeed(77949n, a.key, b.key, playId), tier = TIER_ORDER[k % 4];
    const plain = breed({ a, b, seed, tier, playId });
    const taken = new Set([plain.name, "Momo"]);
    const renamed = breed({ a, b, seed, tier, playId, takenNames: taken });
    assert.notEqual(renamed.name, plain.name, "a taken name is never reused");
    assert.match(renamed.name, /^[A-Z][a-z]{3}$/);
    assert.ok(!isBlockedName(renamed.name));
    assert.equal(breed({ a, b, seed, tier, playId, takenNames: new Set(taken) }).name, renamed.name, "same seed and taken names, same name");
    assert.deepEqual(frames(renamed).map(frame => Array.from(frame)), frames(plain).map(frame => Array.from(frame)), "the pixels do not change");
    assert.deepEqual([renamed.dna.rowSource, renamed.dna.traits, renamed.family], [plain.dna.rowSource, plain.dna.traits, plain.family]);
    assert.equal(breed({ a, b, seed, tier, playId, takenNames: new Set(["Zzzz"]) }).name, plain.name, "a free name stays");
  }
});

// Inherited shape mutations. Oracle: a parent's trait is carried when every row holding its cells, in any of the 16
// frames (idle 0-7, walk 0-7) of any facing it grew on, came from that parent and every cell is ink in the baby's own
// frame (rows are copied in place). A Side-walker baby is checked on its two sides only.
const HEAD_LABELS = ["Antennae", "Horns", "Ears", "Crest", "Long Antennae", "Big Horns", "Bunny Ears", "Mohawk"];
const frameOf = (creature: Creature, facing: Facing, k: number) => creature.sheet[k < 8 ? "idle" : "walk"][facing][k % 8];
const traitFacings = (shape: ShapeTrait, sideWalker: boolean) => (sideWalker ? ["right", "left"] as const : FACINGS).filter(facing => shape.cells[facing]?.length);
function carries(baby: Creature, side: 0 | 1, shape: ShapeTrait, facings: readonly Facing[]) {
  return facings.every(facing => shape.cells[facing]!.every((cells, k) =>
    cells.every(cell => baby.dna!.rowSource[cell >> 4] === side && frameOf(baby, facing, k)[cell] === 1)));
}
const mutatedParent = (k: number) => {
  const [a, b] = randomPair();
  return hatch(a, b, k % 5 === 0 ? "prismatic" : "mutant").baby;
};

test(`shape mutations pass on ${PASS_ON_ODDS}, in every tier, deterministically and only when the pixels are there`, t => {
  let passable = 0, carried = 0, commons = 0;
  const perTier = Object.fromEntries(TIER_ORDER.map(tier => [tier, [0, 0]])) as Record<TierId, number[]>;
  for (let k = 0; k < 400; k++) {
    const parent = mutatedParent(k), mate = pool[random(pool.length)], side = (k % 2) as 0 | 1;
    assert.ok((parent.dna!.shapes ?? []).every(shape => !shape.from), "a hatch from Friends grows its own shapes");
    const [a, b] = side ? [mate, parent] : [parent, mate], tier = TIER_ORDER[k % 4];
    const offer = passableShapes(a, b).filter(item => item.side === side);
    const { baby, result } = hatch(a, b, tier);
    const again = breed({ a, b, tier, playId: baby.playId!, seed: breedSeed(77949n, a.key, b.key, baby.playId!) });
    assert.deepEqual([again.dna.rowSource, again.dna.traits, again.dna.shapes], [result.dna.rowSource, result.dna.traits, result.dna.shapes], "deterministic");
    const inherited = (result.dna.shapes ?? []).filter(shape => shape.from);
    // The detector agrees with the oracle on every trait the parent has, both ways (no false positives or negatives).
    const sideWalker = result.dna.traits.includes("Side-walker");
    for (const shape of parent.dna!.shapes ?? []) {
      const facings = traitFacings(shape, sideWalker);
      const expected = facings.length > 0 && carries(baby, side, shape, facings);
      const found = inherited.find(item => item.label === shape.label && item.from!.side === side);
      assert.equal(!!found, expected, `${parent.name} ${shape.label} -> ${baby.name} (${tier})`);
      if (found) {
        assert.equal(found.from!.name, parent.name);
        assert.ok(result.dna.traits.includes(`${shape.label} (from ${parent.name})`), "the trait line names the source");
        assert.deepEqual(found.cells, Object.fromEntries(facings.map(facing => [facing, shape.cells[facing]])), "same cells as the parent");
      }
    }
    assert.deepEqual(inheritedShapes(a, b, result.dna.rowSource, result.sheet).map(shape => shape.label), inherited.map(shape => shape.label));
    passable += offer.length;
    const got = inherited.filter(shape => shape.from!.side === side).length;
    carried += got;
    perTier[tier][0] += offer.length; perTier[tier][1] += got;
    if (tier === "common" && got) commons++;
    if (tier === "common") assert.equal(ink(result.dna.pattern), 0, "an inherited shape never gives a Common a pattern");
    assertHealthy(result, `${parent.name} x ${mate.name} ${tier}`);
  }
  const rate = carried / passable;
  t.diagnostic(`pass-on rate ${carried}/${passable} = ${rate.toFixed(3)}; per tier ${TIER_ORDER.map(tier => `${tier} ${(perTier[tier][1] / perTier[tier][0]).toFixed(2)}`).join(", ")}`);
  assert.ok(passable > 300, `enough samples (${passable})`);
  assert.ok(rate > 0.42 && rate < 0.58, `"${PASS_ON_ODDS}" is backed by the measured rate ${rate.toFixed(3)}`);
  for (const tier of TIER_ORDER) assert.ok(perTier[tier][1] / perTier[tier][0] > 0.35, `${tier} babies inherit too`);
  assert.ok(commons > 20, `Common babies inherit shapes (${commons})`);
});

test("no inherited shapes without a mutated parent", () => {
  for (let k = 0; k < 120; k++) {
    const [a, b] = randomPair(), tier = TIER_ORDER[k % 4];
    const { result, baby } = hatch(a, b, tier);
    assert.ok((result.dna.shapes ?? []).every(shape => !shape.from), "Friends carry no shapes");
    assert.ok(result.dna.traits.every(trait => !trait.includes("(from ")));
    assert.deepEqual(passableShapes(a, b), []);
    // A Common or Spotted baby (no shapes) passes nothing on either.
    if (tier === "common" || tier === "spotted") {
      const next = hatch(baby, pool[random(pool.length)], "common").result;
      assert.deepEqual(next.dna.shapes, []);
      assert.ok(next.dna.traits.every(trait => !trait.includes("(from ")));
    }
  }
});

test("an inherited shape is whole in every frame: it bobs and walks with the body in all four facings", () => {
  let checked = 0, moving = 0;
  for (let k = 0; k < 200; k++) {
    const parent = mutatedParent(k), side = (k % 2) as 0 | 1, mate = pool[random(pool.length)];
    // The parent's body before it grew anything: the same seed as a Common (rows and repair do not depend on the tier).
    const [pa, pb] = [parent.parents!, parent.playId!] as const, founders = pa.map(key => pool.find(item => item.key === key)!);
    const plain = breed({ a: founders[0], b: founders[1], tier: "common", playId: pb, seed: breedSeed(77949n, pa[0], pa[1], pb) });
    for (const shape of parent.dna!.shapes ?? []) for (const facing of FACINGS) {
      const lists = shape.cells[facing];
      if (!lists) continue;
      assert.equal(lists.length, FACING_FRAMES, "one cell list per frame");
      // The recorded cells are real growth: ink on the parent in that very frame, and paper on its plain body in the
      // reference frame (a piece may cross body ink while the body moves).
      lists.forEach((cells, f) => assert.ok(cells.length > 0 && cells.every(cell => frameOf(parent, facing, f)[cell] === 1), `${parent.name} ${shape.label} ${facing} frame ${f}`));
      assert.ok(lists[0].every(cell => plain.sheet.idle[facing][0][cell] === 0), `${parent.name} ${shape.label} grew on paper (${facing})`);
      if (new Set(lists.map(cells => Math.min(...cells.map(cell => cell >> 4)))).size > 1) moving++;
    }
    const [a, b] = side ? [mate, parent] : [parent, mate];
    const { baby } = hatch(a, b, TIER_ORDER[k % 4]);
    for (const shape of (baby.dna!.shapes ?? []).filter(item => item.from)) for (const facing of FACINGS) (shape.cells[facing] ?? []).forEach((cells, f) => {
      assert.ok(cells.every(cell => frameOf(baby, facing, f)[cell] === 1), `${baby.name} keeps ${shape.label} in ${facing} frame ${f}`);
      checked++;
    });
  }
  assert.ok(checked > 1000, `frames checked (${checked})`);
  assert.ok(moving > 20, `some shapes move between frames, so frame 0 alone would not do (${moving})`);
});

test("shapes travel grandparent -> parent -> baby at the same rate, and are never grown twice", t => {
  let offered = 0, carried = 0, doubled = 0, mutantsWithHead = 0;
  for (let k = 0; k < 500; k++) {
    const grand = mutatedParent(k);
    const parent = hatch(grand, pool[random(pool.length)], TIER_ORDER[k % 4]);
    const inherited = (parent.result.dna.shapes ?? []).filter(shape => shape.from);
    // Mutant and Prismatic babies that already carry a head mutation grow no second one (a tail at most).
    if ((parent.baby.tier === "mutant" || parent.baby.tier === "prismatic") && inherited.some(shape => shape.kind === "head")) {
      mutantsWithHead++;
      const grown = (parent.result.dna.shapes ?? []).filter(shape => !shape.from);
      if (grown.some(shape => shape.kind === "head")) doubled++;
      assert.equal(parent.result.dna.traits.filter(trait => HEAD_LABELS.includes(trait)).length, 0, "no second head label");
      assert.ok(grown.every(shape => shape.kind === "tail" && !inherited.some(item => item.kind === "tail")));
    }
    if (!inherited.length) continue;
    const mate = pool[random(pool.length)];
    offered += passableShapes(mate, parent.baby).filter(item => item.side === 1 && inherited.some(shape => shape.label === item.label)).length;
    const child = hatch(mate, parent.baby, "common").result;
    const again = (child.dna.shapes ?? []).filter(shape => shape.from?.side === 1 && inherited.some(item => item.label === shape.label));
    for (const shape of again) {
      assert.equal(shape.from!.name, parent.baby.name, "the source is the parent that passed it on");
      const original = inherited.find(item => item.label === shape.label)!;
      for (const view of ["down", "right"] as const) if (shape.cells[view]) assert.deepEqual(shape.cells[view], original.cells[view], "the grandparent's own pixels");
    }
    carried += again.length;
  }
  t.diagnostic(`second generation pass-on ${carried}/${offered} = ${(carried / offered).toFixed(3)}; ${mutantsWithHead} Mutant/Prismatic babies already had a head`);
  assert.ok(offered > 150 && carried / offered > 0.4 && carried / offered < 0.62, `F3 rate ${(carried / offered).toFixed(3)}`);
  assert.ok(mutantsWithHead > 50);
  assert.equal(doubled, 0);
});

test("a patterned parent's pattern kind is preferred when the tier shows a pattern", () => {
  const KINDS = ["Spots", "Stripes", "Patch"];
  let same = 0, total = 0;
  for (let k = 0; k < 200; k++) {
    const [a, b] = randomPair();
    const parent = hatch(a, b, "spotted").baby, kind = parent.dna!.traits.find(trait => KINDS.includes(trait))!;
    const child = hatch(parent, pool[random(pool.length)], k % 2 ? "spotted" : "mutant").result;
    total++;
    if (child.dna.traits.includes(kind)) same++;
  }
  assert.ok(same / total > 0.75, `children show the parent's kind ${same}/${total}`);
});
