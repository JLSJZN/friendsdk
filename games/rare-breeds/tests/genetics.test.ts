// Genetics tests. Run from the SDK root: node --test "games/rare-breeds/tests/*.test.ts"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { breed, breedSeed } from "../src/genetics.ts";
import { babyName, isBlockedName } from "../src/names.ts";
import { COLOSSUS, creatureFromRecord, FAMILY_NAMES, type WildFriendRecord } from "../src/sprites.ts";
import { FACINGS, TIER_ORDER, type BreedResult, type Creature, type Frame, type TierId } from "../src/types.ts";

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
    assert.equal(f2.result.family, `${FAMILY_NAMES[left.familyId]} × ${FAMILY_NAMES[right.familyId]}`);
    const f3 = hatch(f2.baby, k % 2 ? pinned : left, TIER_ORDER[(k + 3) % 4]);
    assert.equal(f3.result.lineage, 3);
    assertHealthy(f3.result, `F3 ${k}`);
  }
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
    names.add(name);
  }
  assert.ok(names.size > 1500, `variety: ${names.size} names`);
});
