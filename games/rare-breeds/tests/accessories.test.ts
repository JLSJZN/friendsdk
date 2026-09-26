// Accessory tests. Run from the SDK root: node --test "games/rare-breeds/tests/*.test.ts"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ACCESSORIES, ACCESSORY_BOUNDS, accessoryPixels, type AccessoryPixel } from "../src/accessories.ts";
import { breed, breedSeed } from "../src/genetics.ts";
import { creatureFromRecord, type WildFriendRecord } from "../src/sprites.ts";
import { FACINGS, type AccessoryId, type Clip, type Creature, type Facing, type Frame, type SpriteSheet, type TierId } from "../src/types.ts";

const records: WildFriendRecord[] = JSON.parse(readFileSync(new URL("../data/wild-friends.json", import.meta.url), "utf8")).friends;
const pool = records.map(record => creatureFromRecord(record));
const pinned = pool.find(creature => creature.tokenId === 77949n)!;
const CLIPS: readonly Clip[] = ["idle", "walk"];
const IDS = ACCESSORIES.map(item => item.id);
const ink = (frame: Frame, x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && frame[y * 16 + x] === 1;
const symmetric = (frame: Frame) => frame.every((value, i) => value === frame[(i >> 4) * 16 + 15 - (i & 15)]);
const keyOf = (cells: readonly AccessoryPixel[]) => cells.map(cell => `${cell.x},${cell.y},${cell.color}`).sort();

let plays = 0n;
function hatch(a: Creature, b: Creature, tier: TierId): Creature {
  const playId = ++plays, result = breed({ a, b, seed: breedSeed(77949n, a.key, b.key, playId), tier, playId });
  return Object.freeze({ key: `baby:${playId}`, kind: "baby", name: result.name, family: result.family, familyId: result.familyId,
    lineage: result.lineage, sheet: result.sheet, tier, dna: result.dna, playId });
}
let state = 0x1234567;
const random = (n: number) => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state % n; };
const babies: Creature[] = [];
for (let k = 0; k < 24; k++) babies.push(hatch(pool[random(pool.length)], pool[random(pool.length)], (["common", "spotted", "mutant", "prismatic"] as const)[k % 4]));
for (let k = 0; k < 8; k++) babies.push(hatch(babies[random(babies.length)], babies[random(babies.length)], k % 2 ? "mutant" : "prismatic"));

/** The largest 8-connected part of a frame (a body without the sparkles floating around it). */
function largestPart(frame: Frame): Frame {
  const label = new Int16Array(256), sizes = [0];
  for (let start = 0; start < 256; start++) if (frame[start] && !label[start]) {
    const stack = [start], id = sizes.length;
    label[start] = id; sizes.push(0);
    while (stack.length) {
      const cell = stack.pop()!;
      sizes[id]++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = (cell & 15) + dx, y = (cell >> 4) + dy, next = y * 16 + x;
        if (ink(frame, x, y) && !label[next]) { label[next] = id; stack.push(next); }
      }
    }
  }
  const main = sizes.indexOf(Math.max(...sizes.slice(1)));
  return Uint8Array.from(label, value => Number(value === main));
}

/** Chebyshev distance from the accessory to the nearest body ink. */
function gap(frame: Frame, cells: readonly AccessoryPixel[]): number {
  let best = Infinity;
  for (const cell of cells) for (let i = 0; i < 256; i++) if (frame[i]) best = Math.min(best, Math.max(Math.abs((i & 15) - cell.x), Math.abs((i >> 4) - cell.y)));
  return best;
}

function checkCreature(creature: Creature, label: string) {
  for (const id of IDS) for (const clip of CLIPS) for (const facing of FACINGS) for (let frame = 0; frame < 8; frame++) {
    const cells = accessoryPixels(creature.sheet, clip, facing, frame, id), body = creature.sheet[clip][facing][frame];
    const where = `${label} ${id} ${clip} ${facing} ${frame}`;
    assert.ok(cells.length >= 3, `${where}: the accessory shows (${cells.length} cells)`);
    for (const cell of cells) {
      assert.ok(cell.x >= ACCESSORY_BOUNDS.left && cell.x <= ACCESSORY_BOUNDS.right && cell.y >= ACCESSORY_BOUNDS.top && cell.y <= ACCESSORY_BOUNDS.bottom, `${where}: in bounds`);
      assert.ok(Number.isInteger(cell.x) && Number.isInteger(cell.y) && /^#[0-9A-F]{6}$/i.test(cell.color), `${where}: a pixel`);
      assert.ok(!ink(body, cell.x, cell.y), `${where}: never covers body ink`);
    }
    assert.equal(new Set(cells.map(cell => `${cell.x},${cell.y}`)).size, cells.length, `${where}: no duplicate cells`);
    // Worn, not floating: hats touch the head; the halo floats one row above it.
    const distance = gap(body, cells);
    // The halo floats one row clear of the body (sparkles around a body may come close).
    if (id === "halo") {
      const clear = gap(largestPart(body), cells);
      assert.ok(distance >= 1 && (clip === "idle" && frame === 0 ? clear === 2 : clear <= 2), `${where}: halo floats just above (${clear})`);
    }
    else assert.ok(distance === 1 || (id === "headphones" && distance <= 2), `${where}: sits on the head (${distance})`);
  }
}

test("catalog keeps the contract order, cheapest first", () => {
  assert.deepEqual(IDS, ["party-hat", "bow", "flower", "beanie", "headphones", "top-hat", "crown", "halo"]);
  ACCESSORIES.forEach((item, k) => {
    assert.ok(item.name && item.blurb && item.price > 0);
    assert.ok(!/[–—]/.test(item.name + item.blurb));
    if (k) assert.ok(item.price >= ACCESSORIES[k - 1].price);
  });
});

test("every accessory on every pool Friend: 64 frames in bounds, never on ink, worn on the head", () => {
  for (const creature of pool) checkCreature(creature, creature.name);
});

test("babies, mutants, prismatics, Side-walkers and F2 wear them too", () => {
  assert.ok(babies.some(baby => baby.lineage === 2) && babies.some(baby => baby.dna!.traits.includes("Side-walker")));
  babies.forEach((baby, k) => checkCreature(baby, `baby ${k} ${baby.family} ${baby.tier}`));
});

test("anchoring follows the head: a sprite shifted down moves its accessory down", () => {
  const shift = (frame: Frame, dy: number) => { const out = new Uint8Array(256); for (let i = 0; i < 256 - dy * 16; i++) out[i + dy * 16] = frame[i]; return out; };
  for (const creature of [pinned, ...pool.filter((_, k) => k % 6 === 0)]) {
    const clip = (list: readonly Frame[]) => list.map((_, i) => shift(list[0], i % 3));
    const sheet: SpriteSheet = {
      idle: Object.fromEntries(FACINGS.map(facing => [facing, clip(creature.sheet.idle[facing])])) as Record<Facing, Frame[]>,
      walk: Object.fromEntries(FACINGS.map(facing => [facing, clip(creature.sheet.walk[facing])])) as Record<Facing, Frame[]>,
    };
    for (const id of IDS) for (const facing of FACINGS) {
      const base = accessoryPixels(sheet, "idle", facing, 0, id);
      for (const frame of [1, 2]) {
        const moved = accessoryPixels(sheet, "idle", facing, frame, id);
        const expected = base.map(cell => ({ ...cell, y: cell.y + frame })).filter(cell => cell.y <= ACCESSORY_BOUNDS.bottom && !ink(sheet.idle[facing][frame], cell.x, cell.y));
        assert.deepEqual(keyOf(moved), keyOf(expected), `${creature.name} ${id} ${facing} frame ${frame} moves with the head`);
      }
    }
  }
});

test("canonical idle bob: when the head drops a row, the accessory drops with it", () => {
  let checked = 0;
  for (const creature of pool) for (const facing of FACINGS) {
    const frames = creature.sheet.idle[facing], first = frames[0];
    // Independent head height: topmost ink row over the middle columns.
    const top = (frame: Frame) => { for (let y = 0; y < 16; y++) for (let x = 5; x <= 10; x++) if (ink(frame, x, y)) return y; return -1; };
    for (let frame = 1; frame < 8; frame++) {
      const drop = top(frames[frame]) - top(first);
      if (drop !== 1) continue;
      for (const id of ["top-hat", "crown", "halo"] as AccessoryId[]) {
        const base = accessoryPixels(creature.sheet, "idle", facing, 0, id), now = accessoryPixels(creature.sheet, "idle", facing, frame, id);
        const lowest = (cells: readonly AccessoryPixel[]) => Math.max(...cells.map(cell => cell.y));
        assert.equal(lowest(now) - lowest(base), 1, `${creature.name} ${facing} ${id} frame ${frame}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 300, `checked ${checked} bob frames`);
});

test("front views of symmetric Friends get symmetric hats, and left mirrors right", () => {
  const mirrorCells = (cells: readonly AccessoryPixel[]) => keyOf(cells.map(cell => ({ ...cell, x: 15 - cell.x })));
  let symmetricChecks = 0, mirrorChecks = 0;
  for (const creature of pool) {
    for (const id of ["party-hat", "beanie", "headphones", "top-hat", "crown", "halo"] as AccessoryId[]) {
      if (!symmetric(creature.sheet.idle.down[0])) continue;
      const cells = accessoryPixels(creature.sheet, "idle", "down", 0, id);
      assert.deepEqual(keyOf(cells), mirrorCells(cells), `${creature.name} ${id} is centred`);
      symmetricChecks++;
    }
    const mirrors = creature.sheet.idle.left.every((frame, i) => frame.every((value, c) => value === creature.sheet.idle.right[i][(c >> 4) * 16 + 15 - (c & 15)]));
    if (!mirrors) continue;
    for (const id of IDS) for (let frame = 0; frame < 8; frame++) {
      assert.deepEqual(keyOf(accessoryPixels(creature.sheet, "idle", "left", frame, id)), mirrorCells(accessoryPixels(creature.sheet, "idle", "right", frame, id)));
      mirrorChecks++;
    }
  }
  assert.ok(symmetricChecks > 200 && mirrorChecks > 2000);
});

test("deterministic: equal sheets give equal pixels, repeated calls hit the cache", () => {
  for (const creature of [pinned, pool[30], babies[5]]) {
    const copy: SpriteSheet = JSON.parse(JSON.stringify(creature.sheet, (_, value) => value instanceof Uint8Array ? Array.from(value) : value),
      (_, value) => Array.isArray(value) && value.length === 256 && typeof value[0] === "number" ? Uint8Array.from(value) : value);
    for (const id of IDS) for (const clip of CLIPS) for (const facing of FACINGS) for (let frame = 0; frame < 8; frame++) {
      const first = accessoryPixels(creature.sheet, clip, facing, frame, id);
      assert.equal(accessoryPixels(creature.sheet, clip, facing, frame, id), first, "cached");
      assert.deepEqual(keyOf(accessoryPixels(copy, clip, facing, frame, id)), keyOf(first), "same content, same pixels");
    }
  }
});

test("fast: cached calls well under 0.05 ms, first calls cheap too", () => {
  // Fresh sheet objects so nothing is cached yet: 15 creatures walking, one accessory each.
  const fresh = (sheet: SpriteSheet): SpriteSheet => JSON.parse(JSON.stringify(sheet, (_, value) => value instanceof Uint8Array ? Array.from(value) : value),
    (_, value) => Array.isArray(value) && value.length === 256 && typeof value[0] === "number" ? Uint8Array.from(value) : value);
  const calls = babies.slice(0, 15).flatMap((baby, k) => {
    const sheet = fresh(baby.sheet);
    return FACINGS.flatMap(facing => Array.from({ length: 8 }, (_, frame) => [sheet, facing, frame, IDS[k % 8]] as const));
  });
  let start = performance.now();
  for (const [sheet, facing, frame, id] of calls) accessoryPixels(sheet, "walk", facing, frame, id);
  const cold = (performance.now() - start) / calls.length;
  start = performance.now();
  for (let round = 0; round < 50; round++) for (const [sheet, facing, frame, id] of calls) accessoryPixels(sheet, "walk", facing, frame, id);
  const warm = (performance.now() - start) / (calls.length * 50);
  assert.ok(warm < 0.05, `cached ${warm.toFixed(4)} ms per call`);
  assert.ok(cold < 1, `first calls ${cold.toFixed(3)} ms per call`);
});
