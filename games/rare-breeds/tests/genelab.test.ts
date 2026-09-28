// Gene Lab tests (row locks). Run from the SDK root: node --test "games/rare-breeds/tests/*.test.ts"
// GOLDEN_PRINT=1 prints the golden digests instead of checking them (only after an intended genetics change).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { breed, breedSeed, EDGE_ROWS, edgeLocks, inheritedShapes, isSideWalker, lockCount, lockOptions, lockOptionsReady, MASK_COUNT, NO_LOCKS, passableShapes } from "../src/genetics.ts";
import { FREE_LOCKS, LOCK_PRICE, lockCost, lockCostLabel } from "../src/hearts.ts";
import { COLOSSUS, creatureFromRecord, type WildFriendRecord } from "../src/sprites.ts";
import { FACINGS, TIER_ORDER, type BreedResult, type Creature, type Facing, type RowLock, type TierId } from "../src/types.ts";

const records: WildFriendRecord[] = JSON.parse(readFileSync(new URL("../data/wild-friends.json", import.meta.url), "utf8")).friends;
const pool = records.map(record => creatureFromRecord(record));
const CLIPS = ["idle", "walk"] as const;

/** Own xorshift stream per test, so samples never depend on test order. */
function xorshift(seed: number) {
  let state = seed >>> 0;
  return (n: number) => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state % n; };
}

function babyOf(a: Creature, b: Creature, tier: TierId, playId: bigint, result = breed({ a, b, tier, playId, seed: breedSeed(77949n, a.key, b.key, playId) })): Creature {
  return Object.freeze({
    key: `baby:${playId}`, kind: "baby", name: result.name, family: result.family, familyId: result.familyId, lineage: result.lineage,
    sheet: result.sheet, tier, parents: [a.key, b.key] as const, dna: result.dna, playId,
  });
}

/** Everything a hatch produces, as one string: all 64 frames, the pattern, the whole Dna, name, family and lineage. */
function serialise(result: BreedResult): string {
  const hex = (bytes: ArrayLike<number>) => Array.from(bytes, value => value.toString(16)).join("");
  const frames = CLIPS.flatMap(clip => FACINGS.flatMap(facing => result.sheet[clip][facing].map(hex)));
  const { rowSource, pattern, mutations, traits, shapes } = result.dna;
  return JSON.stringify([frames, hex(pattern), rowSource, mutations, traits, shapes ?? null, result.name, result.family, result.familyId, result.lineage]);
}
const digest = (results: readonly BreedResult[]) => createHash("sha256").update(results.map(serialise).join("\n")).digest("hex").slice(0, 12);

/**
 * Golden samples: pool pairs (Colossus pairs included) and F2 babies whose baby parent carries a shape (either side, and
 * F1 x F1), each bred in all four tiers. Digests were taken from the genetics before the Gene Lab existed.
 */
function goldenSamples() {
  const random = xorshift(0x5eed1ab5);
  const pair = (): [Creature, Creature] => {
    const a = pool[random(pool.length)];
    let b = pool[random(pool.length)];
    while (b === a) b = pool[random(pool.length)];
    return [a, b];
  };
  const samples: { label: string; a: Creature; b: Creature; playId: bigint }[] = [];
  for (let k = 0; k < 40; k++) { const [a, b] = pair(); samples.push({ label: `pool ${k}`, a, b, playId: BigInt(5000 + k) }); }
  const colossi = pool.filter(creature => creature.familyId === COLOSSUS), others = pool.filter(creature => creature.familyId !== COLOSSUS);
  for (let k = 0; k < 6; k++) {
    const colossus = colossi[random(colossi.length)], other = others[random(others.length)];
    const [a, b] = k % 2 ? [colossus, other] : [other, colossus];
    samples.push({ label: `colossus ${k}`, a, b, playId: BigInt(5100 + k) });
  }
  // Baby parents with shapes: the first Mutant or Prismatic hatch of a pool pair that grew one.
  const shaped: Creature[] = [];
  for (let playId = 6000n; shaped.length < 24; playId++) {
    const [a, b] = pair(), tier = playId % 3n ? "mutant" : "prismatic";
    const baby = babyOf(a, b, tier, playId);
    if ((baby.dna!.shapes ?? []).length) shaped.push(baby);
  }
  shaped.forEach((parent, k) => {
    const mate = k % 3 === 2 ? shaped[(k + 1) % shaped.length] : pool[random(pool.length)];
    const [a, b] = k % 2 ? [mate, parent] : [parent, mate];
    samples.push({ label: `F2 ${k}`, a, b, playId: BigInt(7000 + k) });
  });
  return samples;
}

const GOLDEN: Record<string, string> = {
  "pool 0": "8200858572f6", "pool 1": "f3f6699c1741", "pool 2": "cefb22dc0a40", "pool 3": "694c903e699c", "pool 4": "df991a8a70e0",
  "pool 5": "19623ab36dc2", "pool 6": "ddb81468734c", "pool 7": "5604e48997b0", "pool 8": "3a4ba2d01d5d", "pool 9": "08f83cbf14d3",
  "pool 10": "d4bd833cfbaf", "pool 11": "c47e688db02d", "pool 12": "4959b7de3ed7", "pool 13": "2ffe1111aff3", "pool 14": "bc9b55b89057",
  "pool 15": "622212cbc48e", "pool 16": "30076817cb7a", "pool 17": "ff32dec1bbd9", "pool 18": "01a4c28e3be7", "pool 19": "468c31440720",
  "pool 20": "5be7c3630e36", "pool 21": "4b7b6eaf664a", "pool 22": "d78fe3e6ac2e", "pool 23": "44aed7f3dbf8", "pool 24": "1f2bdf316710",
  "pool 25": "e99e97c52c1e", "pool 26": "9b26462506ad", "pool 27": "45dd711d90f5", "pool 28": "7af566fdbae8", "pool 29": "08474ca77fce",
  "pool 30": "51299a594724", "pool 31": "59971b7e0132", "pool 32": "314d58936715", "pool 33": "8058905b8376", "pool 34": "4368039c2ba2",
  "pool 35": "296ad1772223", "pool 36": "154623466155", "pool 37": "2cd5e15c59a6", "pool 38": "cb4d71ada045", "pool 39": "207082261d9f",
  "colossus 0": "545980f33c73", "colossus 1": "c373a2218cb4", "colossus 2": "a052a9e5dce8", "colossus 3": "5bda0ace505f", "colossus 4": "524c28a813b3",
  "colossus 5": "f84ab581ca5b", "F2 0": "6cdc5d156714", "F2 1": "3cd2733b8abd", "F2 2": "08f15255f58f", "F2 3": "ddb0ad55ea03",
  "F2 4": "8542f7ea8bad", "F2 5": "c17a14760148", "F2 6": "64de61bc2ca3", "F2 7": "75231657934d", "F2 8": "1e1b1830fbf1",
  "F2 9": "b0201b45dfe5", "F2 10": "f412801a9460", "F2 11": "42e1b3476f83", "F2 12": "631f2db52cb1", "F2 13": "b061f52f7059",
  "F2 14": "6873c1351adc", "F2 15": "7610cebc34a7", "F2 16": "eefd4b89aebc", "F2 17": "3de54ba741cb", "F2 18": "e0bf9e2182b1",
  "F2 19": "665e6597a59a", "F2 20": "54d5cead49e6", "F2 21": "9f313142b3d5", "F2 22": "27c92ee7412f", "F2 23": "173df9db1dfe",
};

test("golden: without locks every baby is byte-identical to the genetics before the Gene Lab", t => {
  const printed: string[] = [];
  for (const { label, a, b, playId } of goldenSamples()) {
    const results = TIER_ORDER.map(tier => breed({ a, b, tier, playId, seed: breedSeed(77949n, a.key, b.key, playId) }));
    const hash = digest(results);
    if (process.env.GOLDEN_PRINT) { printed.push(`  "${label}": "${hash}",`); continue; }
    assert.equal(hash, GOLDEN[label], `${label}: ${a.name} x ${b.name}`);
  }
  if (printed.length) t.diagnostic(`\n${printed.join("\n")}`);
});

test("all-free locks are no locks: the same baby, and no lock record", () => {
  const random = xorshift(0x10c5);
  for (let k = 0; k < 40; k++) {
    const a = pool[random(pool.length)], b = pool[(pool.indexOf(a) + 1 + random(pool.length - 1)) % pool.length];
    const playId = BigInt(300 + k), tier = TIER_ORDER[k % 4], input = { a, b, tier, playId, seed: breedSeed(77949n, a.key, b.key, playId) };
    const plain = breed(input), free = breed({ ...input, locks: NO_LOCKS });
    assert.equal(serialise(free), serialise(plain));
    assert.equal(free.dna.locks, undefined);
  }
});

// Parents for the lock tests: pool pairs and baby parents (F1 babies with shapes, F2 mixes), as the Matchmaker offers them.
function labPairs(count: number, seed: number): [Creature, Creature][] {
  const random = xorshift(seed), pairs: [Creature, Creature][] = [];
  const wildPick = () => pool[random(pool.length)];
  for (let k = 0; pairs.length < count; k++) {
    const a = wildPick(), b = wildPick();
    if (a === b) continue;
    if (k % 3 === 0) pairs.push([a, b]);
    else {
      const baby = babyOf(a, b, k % 2 ? "mutant" : "prismatic", BigInt(20000 + k));
      pairs.push(k % 3 === 1 ? [baby, wildPick()] : [wildPick(), baby]);
    }
  }
  return pairs;
}

/** A random lock set the Gene Lab allows: one row at a time, each only when lockOptions says it keeps a possible baby. */
function randomLocks(a: Creature, b: Creature, random: (n: number) => number, steps: number): RowLock[] {
  const locks: RowLock[] = NO_LOCKS.slice();
  for (let k = 0; k < steps; k++) {
    const y = random(16), side = random(2) as 0 | 1;
    if (locks[y] === side) { locks[y] = null; continue; }
    if (lockOptions(a, b, locks).allowed[y][side]) locks[y] = side;
  }
  return locks;
}

/** The parent frame a baby frame's rows come from: Side-walker babies show their right frames from every side. */
const sourceFrame = (parent: Creature, clip: "idle" | "walk", facing: Facing, i: number, sideWalker: boolean) =>
  parent.sheet[clip][sideWalker && (facing === "down" || facing === "up") ? "right" : facing][i];

test("every locked row comes from the chosen parent in all 64 frames (many pairs, random allowed lock sets, every tier)", t => {
  const random = xorshift(0x1ab5);
  let babies = 0, lockedRows = 0;
  for (const [a, b] of labPairs(90, 0xc0ffee)) for (let round = 0; round < 3; round++) {
    const locks = randomLocks(a, b, random, 2 + random(14));
    if (!lockCount(locks)) continue;
    const options = lockOptions(a, b, locks);
    assert.ok(options.possible > 0, "an allowed lock set always leaves a possible baby");
    const tier = TIER_ORDER[random(4)], playId = BigInt(40000 + babies);
    const result = breed({ a, b, tier, playId, seed: breedSeed(77949n, a.key, b.key, playId), locks });
    assert.deepEqual(result.dna.locks, locks, "the baby records its locks");
    const sideWalker = isSideWalker(a) || isSideWalker(b);
    locks.forEach((lock, y) => {
      if (lock === null) return;
      assert.equal(result.dna.rowSource[y], lock, `row ${y} from parent ${lock}`);
      const parent = lock ? b : a;
      for (const clip of CLIPS) for (const facing of FACINGS) result.sheet[clip][facing].forEach((frame, i) => {
        const from = sourceFrame(parent, clip, facing, i, sideWalker);
        for (let x = 0; x < 16; x++) if (from[y * 16 + x]) assert.equal(frame[y * 16 + x], 1, `${a.name} x ${b.name} ${clip} ${facing} ${i} row ${y}: ${parent.name}'s pixel`);
      });
      lockedRows++;
    });
    // The hatched mask was one of the counted possible babies: locking every row to it leaves exactly that one.
    assert.equal(lockOptions(a, b, result.dna.rowSource).possible, 1, "the baby is one of the possible babies");
    babies++;
  }
  t.diagnostic(`${babies} locked babies, ${lockedRows} locked rows checked in all 64 frames`);
  assert.ok(babies > 200 && lockedRows > 1000);
});

test("a toggle is disabled exactly when it would leave no possible baby", () => {
  const random = xorshift(0xd15a);
  let disabled = 0, checked = 0;
  for (const [a, b] of labPairs(40, 0xfeed)) {
    const locks = randomLocks(a, b, random, 1 + random(12)), options = lockOptions(a, b, locks);
    assert.ok(options.possible >= 1 && options.possible <= MASK_COUNT);
    for (let y = 0; y < 16; y++) for (const side of [0, 1] as const) {
      const next = locks.slice();
      next[y] = side;
      assert.equal(options.allowed[y][side], lockOptions(a, b, next).possible > 0, `row ${y} side ${side}`);
      if (!options.allowed[y][side]) disabled++;
      checked++;
    }
  }
  assert.ok(disabled > 50, `some toggles are disabled (${disabled} of ${checked})`);
});

test("locks keep the seeded choice: the same locks still hatch different babies across plays, the same play the same baby", () => {
  const random = xorshift(0x5eed);
  let varied = 0, sets = 0;
  for (const [a, b] of labPairs(30, 0xabc)) {
    const locks = randomLocks(a, b, random, 3);
    if (!lockCount(locks) || lockOptions(a, b, locks).possible < 20) continue;
    sets++;
    const masks = new Set<string>();
    for (let k = 0; k < 12; k++) {
      const playId = BigInt(900 + k), input = { a, b, tier: "common" as const, playId, seed: breedSeed(77949n, a.key, b.key, playId), locks };
      const first = breed(input);
      assert.equal(serialise(breed(input)), serialise(first), "deterministic");
      masks.add(first.dna.rowSource.join(""));
    }
    if (masks.size > 2) varied++;
  }
  assert.ok(sets > 10 && varied > sets * 0.8, `varied ${varied} of ${sets}`);
});

test("an impossible lock set is ignored: the baby is the one bred without locks", () => {
  const [a, b] = [pool[0], pool[1]], playId = 77n, input = { a, b, tier: "spotted" as const, playId, seed: breedSeed(77949n, a.key, b.key, playId) };
  // A single-row run (row 1 alone from B) is no mask of 2 to 5 rows.
  const result = breed({ ...input, locks: [0, 1, 0, null, null, null, null, null, null, null, null, null, null, null, null, null] });
  assert.equal(serialise(result), serialise(breed(input)));
  assert.equal(result.dna.locks, undefined);
});

test("the shape shortcut: locking all of a shape's rows makes the baby carry it in every tier, and the footer can say so", t => {
  let shortcuts = 0, carried = 0;
  const random = xorshift(0x5a9e);
  for (const [a, b] of labPairs(110, 0x51de)) {
    const offer = passableShapes(a, b), options = lockOptions(a, b, NO_LOCKS);
    assert.deepEqual(options.shapes.map(shape => [shape.label, shape.side, shape.name]), offer.map(item => [item.label, item.side, item.name]), "same list as the Matchmaker's");
    options.shapes.forEach((shape, k) => {
      if (!shape.lockable) return;
      const locks = NO_LOCKS.map((lock, y) => shape.rows.includes(y) ? shape.side : lock);
      assert.equal(lockOptions(a, b, locks).shapes[k].odds, "sure");
      for (const tier of TIER_ORDER) {
        const playId = BigInt(60000 + shortcuts * 4 + TIER_ORDER.indexOf(tier) + random(3));
        const result = breed({ a, b, tier, playId, seed: breedSeed(77949n, a.key, b.key, playId), locks });
        const found = inheritedShapes(a, b, result.dna.rowSource, result.sheet).some(item => item.label === shape.label && item.from!.side === shape.side);
        assert.ok(found, `${shape.label} from ${shape.name} (${tier})`);
        assert.ok((result.dna.shapes ?? []).some(item => item.label === shape.label && item.from?.side === shape.side), "recorded on the baby");
        carried++;
      }
      // Locking one of its rows to the other parent blocks it.
      const other = NO_LOCKS.slice();
      other[shape.rows[0]] = shape.side ? 0 : 1;
      const blocked = lockOptions(a, b, other);
      if (blocked.possible) assert.equal(blocked.shapes[k].odds, "blocked");
      shortcuts++;
    });
  }
  t.diagnostic(`${shortcuts} shape shortcuts, ${carried} babies (4 tiers each) all carry the locked shape`);
  assert.ok(shortcuts > 40);
});

test("edge shortcuts: top and bottom rows from each parent, on every pair, locked exactly when the mask rules allow", t => {
  let lockable = 0, total = 0;
  for (const [a, b] of labPairs(80, 0xed9e)) {
    const edges = edgeLocks(a, b, NO_LOCKS);
    assert.deepEqual(edges.map(edge => [edge.edge, edge.side]), [["top", 0], ["top", 1], ["bottom", 0], ["bottom", 1]]);
    for (const edge of edges) {
      total++;
      assert.equal(edge.rows.length, EDGE_ROWS);
      assert.ok(edge.rows.every((row, k) => row === edge.rows[0] + k && row >= 0 && row < 16), "one run of rows");
      const locks = NO_LOCKS.map((lock, y) => edge.rows.includes(y) ? edge.side : lock);
      // lockable is exactly "a possible baby is left", the same rule as every row toggle.
      assert.equal(edge.lockable, lockOptions(a, b, locks).possible > 0, `${edge.edge} ${edge.side}`);
      if (!edge.lockable) continue;
      lockable++;
      const playId = BigInt(70000 + total);
      const result = breed({ a, b, tier: "common", playId, seed: breedSeed(77949n, a.key, b.key, playId), locks });
      assert.ok(edge.rows.every(row => result.dna.rowSource[row] === edge.side), "the baby takes every locked row");
    }
    // Top rows start at the pair's first inked row: a free first shortcut (EDGE_ROWS is the session's free rows).
    assert.ok(edges[0].rows[0] <= edges[2].rows[0]);
  }
  t.diagnostic(`${lockable} of ${total} edge shortcuts lockable on free rows`);
  assert.equal(EDGE_ROWS, FREE_LOCKS, "a first-time juror's first shortcut costs no Hearts");
  assert.ok(lockable > total * 0.8);
});

test("lockOptionsReady: false until a pair's first lockOptions, then true (the UI defers only that first call)", () => {
  const [a, b] = labPairs(1, 0x4ead)[0];
  const fresh = Object.freeze({ ...a, sheet: { ...a.sheet } }) as Creature;
  assert.equal(lockOptionsReady(fresh, b), false);
  lockOptions(fresh, b, NO_LOCKS);
  assert.equal(lockOptionsReady(fresh, b), true);
});

test("Gene Lab cost: the first look at a pair assesses 630 masks once, every toggle after that is instant", t => {
  const pairs = labPairs(24, 0x71e);
  let first = 0, toggles = 0, count = 0;
  for (const [a, b] of pairs) {
    const fresh = Object.freeze({ ...a, sheet: { ...a.sheet } }) as Creature;
    let start = performance.now();
    lockOptions(fresh, b, NO_LOCKS);
    first += performance.now() - start;
    const locks = NO_LOCKS.slice();
    start = performance.now();
    for (let y = 0; y < 16; y++) { locks[y] = (y >> 2) % 2 as 0 | 1; lockOptions(fresh, b, locks); count++; }
    toggles += performance.now() - start;
  }
  const perPair = first / pairs.length, perToggle = toggles / count;
  t.diagnostic(`first look ${perPair.toFixed(1)} ms per pair, toggle ${perToggle.toFixed(3)} ms`);
  assert.ok(perPair < 250, `first look ${perPair.toFixed(1)} ms`);
  assert.ok(perToggle < 5, `toggle ${perToggle.toFixed(3)} ms`);
});

test("Gene Lab price: Hearts only, 2 per locked row after the session's first 3 free rows", () => {
  assert.deepEqual([LOCK_PRICE, FREE_LOCKS], [2, 3]);
  assert.deepEqual(lockCost(0, 3), { free: 0, hearts: 0 });
  assert.deepEqual(lockCost(3, 3), { free: 3, hearts: 0 }, "a first-time juror with 0 Hearts locks 3 rows on the first hatch");
  assert.deepEqual(lockCost(5, 3), { free: 3, hearts: 4 });
  assert.deepEqual(lockCost(5, 1), { free: 1, hearts: 8 });
  assert.deepEqual(lockCost(4, 0), { free: 0, hearts: 8 });
  assert.deepEqual(lockCost(16, 0), { free: 0, hearts: 32 }, "a fully designed baby");
  assert.deepEqual([lockCostLabel(0, 3), lockCostLabel(3, 3), lockCostLabel(5, 3), lockCostLabel(1, 0)], ["No locks", "3 locks, free", "5 locks, 4 Hearts", "1 lock, 2 Hearts"]);
});
