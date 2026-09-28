// Dream child tests (src/dream.ts). Run from the SDK root: node --test "games/rare-breeds/tests/*.test.ts"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DREAM_HEARTS, DREAM_OFFER, dreamMatch, dreamNews, dreamOf, localDateKey, pickMates, recordHatch, sameRows, seededRandom, stampDream,
  startProgress, wishMates, type Dream,
} from "../src/dream.ts";
import { breed, breedSeed, lockOptions, lockOptionsReady, NO_LOCKS, possibleMasks } from "../src/genetics.ts";
import { lockCost } from "../src/hearts.ts";
import { creatureFromRecord, type WildFriendRecord } from "../src/sprites.ts";
import { lineageTitles } from "../src/titles.ts";
import { FACINGS, FRAME_SIZE, TIER_ORDER, type Creature, type RowLock, type TierId } from "../src/types.ts";

const records: WildFriendRecord[] = JSON.parse(readFileSync(new URL("../data/wild-friends.json", import.meta.url), "utf8")).friends;
const pool = records.map(record => creatureFromRecord(record));
/** Every pool Friend as the player's Friend ("friend:<id>", excluded from its own pool by token ID). */
const friends = records.map(record => creatureFromRecord(record, "friend"));
const CLIPS = ["idle", "walk"] as const;
const DATES = ["2026-09-28", "2026-09-29", "2026-10-05", "2027-01-01"];

/** Dreams of every pool Friend on every sample date, computed once (about 40 ms each). */
const samples: readonly Readonly<{ friend: Creature; date: string; dream: Dream }>[] = friends.flatMap(friend => DATES.map(date => {
  const dream = dreamOf({ date, friend, pool });
  assert.ok(dream, `${friend.name} dreams on ${date}`);
  return { friend, date, dream };
}));

/** A hatch of the pair, as the controller makes it (key, parents, Dna, play ID). */
function hatchOf(a: Creature, b: Creature, tier: TierId, playId: bigint, locks?: readonly RowLock[]): Creature {
  const result = breed({ a, b, tier, playId, seed: breedSeed(a.tokenId ?? 0n, a.key, b.key, playId), locks });
  return Object.freeze({ key: `baby:${playId}`, kind: "baby", name: result.name, family: result.family, familyId: result.familyId, lineage: result.lineage,
    sheet: result.sheet, tier, parents: [a.key, b.key] as const, dna: result.dna, playId });
}
const sameSheet = (x: Creature, y: Creature) => CLIPS.every(clip => FACINGS.every(facing => x.sheet[clip][facing].every((frame, i) => {
  const other = y.sheet[clip][facing][i];
  return frame.every((value, cell) => value === other[cell]);
})));
/** A baby of the dream pair with a hand-made row source (only rowSource and parents matter to dreamMatch). */
const withRows = (dream: Dream, rowSource: readonly (0 | 1)[]): Creature => ({ ...dream.child, key: "baby:rows", dna: { ...dream.child.dna!, rowSource } });

test("a dream is deterministic from the date, the Friend and the round", () => {
  assert.equal(localDateKey(new Date(2026, 8, 28, 23, 59)), "2026-09-28");
  assert.equal(localDateKey(new Date(2027, 0, 1, 0, 0)), "2027-01-01");
  const { friend, date, dream } = samples[0];
  const again = dreamOf({ date, friend, pool })!;
  assert.equal(again.id, `${date}#0`);
  assert.equal(again.mate.key, dream.mate.key);
  assert.deepEqual(again.mask, dream.mask);
  assert.ok(sameSheet(again.child, dream.child), "same dream child, pixel for pixel");
  // A new day is a new dream for most Friends (mate or mask differ).
  const changed = friends.filter(item => {
    const [a, b] = DATES.slice(0, 2).map(day => samples.find(sample => sample.friend === item && sample.date === day)!.dream);
    return a.mate.key !== b.mate.key || a.mask.join("") !== b.mask.join("");
  }).length;
  assert.ok(changed >= friends.length * 0.9, `${changed} of ${friends.length} Friends dream something new the next day`);
});

test("every pool Friend dreams a valid child on every date, never with itself", () => {
  for (const { friend, date, dream } of samples) {
    const label = `${friend.name} on ${date}`;
    assert.notEqual(dream.mate.tokenId, friend.tokenId, `${label}: the mate is never the Friend itself`);
    assert.ok(pool.includes(dream.mate), `${label}: the mate is a wild pool Friend`);
    assert.ok(possibleMasks(friend, dream.mate).some(mask => mask.join("") === dream.mask.join("")), `${label}: the mask really hatches (hard checks pass, it builds)`);
    // The Gene Lab agrees: dreaming assessed the pair (its lab opens without the idle wait), counts the same babies, and the
    // dream's 16 locks leave exactly one possible baby.
    assert.ok(lockOptionsReady(friend, dream.mate), `${label}: the pair is assessed`);
    assert.equal(lockOptions(friend, dream.mate, NO_LOCKS).possible, possibleMasks(friend, dream.mate).length, `${label}: same possible babies as the Gene Lab`);
    assert.equal(lockOptions(friend, dream.mate, dream.mask).possible, 1, `${label}: the dream's locks leave exactly the dream`);
    assert.ok(dream.mask.filter(side => side === 0).length >= 4 && dream.mask.filter(side => side === 1).length >= 4, `${label}: each parent gives at least 4 rows`);
    assert.deepEqual(dream.same, sameRows(friend, dream.mate));
    assert.ok(dream.same.filter(same => !same).length >= 8, `${label}: at least 8 rows tell the parents apart`);
    assert.deepEqual(dream.child.dna!.rowSource, dream.mask);
    assert.equal(dream.child.dna!.pattern.some(Boolean), false, `${label}: no tier pattern`);
    assert.equal(dream.child.dna!.mutations.length, 0, `${label}: no mutation`);
  }
});

test("locking all 16 rows to the dream hatches the dream exactly, in every tier", () => {
  let checked = 0;
  samples.forEach(({ friend, dream }, index) => {
    const tier = TIER_ORDER[index % TIER_ORDER.length], playId = BigInt(1000 + index);
    const baby = stampDream(dream, hatchOf(friend, dream.mate, tier, playId, dream.mask));
    assert.deepEqual(baby.dna!.rowSource, dream.mask, `${friend.name}: every row from the dream's parent`);
    // Common and Spotted add no pixels (a Spotted pattern is a colour stencil), so the body is the dream child's.
    if (tier === "common" || tier === "spotted") assert.ok(sameSheet(baby, dream.child), `${friend.name} (${tier}): the dream child, pixel for pixel`);
    assert.equal(baby.dream?.matched, FRAME_SIZE);
    assert.ok(lineageTitles(baby, () => null, friend).some(title => title.id === "dreamchild"), "the Dreamchild title");
    checked++;
  });
  assert.equal(checked, friends.length * DATES.length);
});

test("a row matches when it came from the dream's parent, or looks the same either way", () => {
  const { friend, dream } = samples.find(sample => sample.dream.same.some(Boolean)) ?? samples[0];
  const telling = dream.mask.map((_, y) => y).filter(y => !dream.same[y]), alike = dream.mask.map((_, y) => y).filter(y => dream.same[y]);
  const flip = (rows: readonly number[]) => dream.mask.map((side, y) => (rows.includes(y) ? 1 - side : side) as 0 | 1);
  assert.equal(dreamMatch(dream, withRows(dream, dream.mask))!.matched, FRAME_SIZE);
  const three = telling.slice(0, 3), match = dreamMatch(dream, withRows(dream, flip(three)))!;
  assert.equal(match.matched, FRAME_SIZE - 3);
  assert.deepEqual(match.rows.map((hit, y) => hit ? -1 : y).filter(y => y >= 0), three, "exactly the flipped rows miss");
  assert.equal(match.id, dream.id);
  if (alike.length) assert.equal(dreamMatch(dream, withRows(dream, flip(alike)))!.matched, FRAME_SIZE, "rows both parents draw alike always match");
  // Only a baby of your Friend (Parent A) and the dream mate (Parent B) counts.
  const other = pool.find(mate => mate.key !== dream.mate.key && mate.tokenId !== friend.tokenId)!;
  assert.equal(dreamMatch(dream, hatchOf(friend, other, "common", 7n)), null);
  assert.equal(dreamMatch(dream, { ...withRows(dream, dream.mask), parents: [dream.mate.key, friend.key] }), null, "the pair reversed does not count");
  assert.equal(stampDream(dream, hatchOf(friend, other, "common", 8n)).dream, undefined);
  // A real hatch without locks: its count equals the rows it shares with the dream (or that look alike).
  const free = stampDream(dream, hatchOf(friend, dream.mate, "spotted", 9n));
  assert.equal(free.dream!.matched, dream.mask.filter((side, y) => dream.same[y] || free.dna!.rowSource[y] === side).length);
  assert.deepEqual(dreamNews(free, null), free.dream!.matched < FRAME_SIZE ? [`Dream match: ${free.dream!.matched} of 16 rows`] : [`Dream come true! +${DREAM_HEARTS} Hearts`]);
});

test("the reward comes once per dream, and Dream again draws a new dream", () => {
  const { friend, date, dream } = samples[5];
  const flipped = dream.mask.map((side, y) => (y === dream.same.indexOf(false) ? 1 - side : side) as 0 | 1);
  const tryBaby = stampDream(dream, { ...withRows(dream, flipped), key: "baby:1" }), solved = stampDream(dream, { ...withRows(dream, dream.mask), key: "baby:2" });
  let progress = startProgress(dream.id);
  const first = recordHatch(progress, tryBaby);
  assert.deepEqual([first.reward, first.progress.eggs, first.progress.best, first.progress.solved], [0, 1, FRAME_SIZE - 1, null]);
  const second = recordHatch(first.progress, solved);
  assert.deepEqual([second.reward, second.progress.eggs, second.progress.best, second.progress.solved], [DREAM_HEARTS, 2, FRAME_SIZE, "baby:2"]);
  assert.deepEqual(dreamNews(solved, second.progress), [`Dream come true! +${DREAM_HEARTS} Hearts`]);
  const third = recordHatch(second.progress, stampDream(dream, { ...solved, key: "baby:3" }));
  assert.equal(third.reward, 0, "a second 16 of 16 of the same dream earns nothing more");
  assert.equal(third.progress.solved, "baby:2");
  assert.deepEqual(dreamNews({ ...solved, key: "baby:3" }, third.progress), ["Dream come true again (Hearts once per dream)"]);
  progress = third.progress;
  // Babies outside the dream pair, or of another dream, leave the progress alone.
  assert.equal(recordHatch(progress, dream.child).progress, progress);
  assert.equal(recordHatch(progress, { ...solved, dream: { ...solved.dream!, id: "2026-01-01#0" } }).progress, progress);
  // Dream again: the next round is another valid dream with its own reward.
  const next = dreamOf({ date, friend, pool, round: 1 })!;
  assert.equal(next.id, `${date}#1`);
  assert.ok(next.mate.key !== dream.mate.key || next.mask.join("") !== dream.mask.join(""), "a new dream");
  assert.ok(possibleMasks(friend, next.mate).some(mask => mask.join("") === next.mask.join("")));
  const fresh = recordHatch(startProgress(next.id), stampDream(next, hatchOf(friend, next.mate, "common", 11n, next.mask)));
  assert.equal(fresh.reward, DREAM_HEARTS, "the new dream pays once more");
  // Rounds differ for most Friends.
  const moved = friends.slice(0, 24).filter(item => {
    const a = dreamOf({ date, friend: item, pool })!, b = dreamOf({ date, friend: item, pool, round: 1 })!;
    return a.mate.key !== b.mate.key || a.mask.join("") !== b.mask.join("");
  }).length;
  assert.equal(moved, 24);
});

test("solvability: how often the dream mate is offered, and eggs and Hearts to make it real", () => {
  // Fresh sets of wild mates (New faces, or the new faces after every hatch) until the dream mate is on offer.
  const random = seededRandom(7730);
  const sets: number[] = [];
  for (const { friend, dream } of samples.filter((_, index) => index % 4 === 0)) for (let run = 0; run < 100; run++) {
    let count = 1;
    for (;;) {
      const offered = pickMates(pool, friend.tokenId, random, dream.mate);
      assert.equal(offered.length, 3);
      assert.ok(!offered.some(mate => mate.tokenId === friend.tokenId), "never your own Friend");
      if (offered.some(mate => mate.key === dream.mate.key)) break;
      count++;
    }
    sets.push(count);
  }
  sets.sort((x, y) => x - y);
  const mean = sets.reduce((sum, value) => sum + value, 0) / sets.length, share = (limit: number) => sets.filter(value => value <= limit).length / sets.length;
  console.log(`  dream mate on offer: first set ${(share(1) * 100).toFixed(1)}%, within 3 sets ${(share(3) * 100).toFixed(1)}%, within 5 ${(share(5) * 100).toFixed(1)}%;`
    + ` mean ${mean.toFixed(2)} sets, median ${sets[sets.length >> 1]}, p90 ${sets[Math.floor(sets.length * 0.9)]} (${sets.length} runs, DREAM_OFFER ${DREAM_OFFER})`);
  assert.ok(share(1) > 0.25 && share(1) < 0.33, "about 1 in 4 plus the plain 3 in 72");
  assert.ok(mean > 3 && mean < 4.2);
  // A Wish for its family always brings it.
  for (const { friend, dream } of samples.slice(0, 40)) {
    const wished = wishMates(pool, dream.mate.familyId, friend.tokenId, random, dream.mate);
    assert.ok(wished.some(mate => mate.key === dream.mate.key));
    assert.ok(wished.every(mate => mate.familyId === dream.mate.familyId && mate.tokenId !== friend.tokenId));
  }
  // Eggs with the dream pair: one free try, then lock the misses to the other parent, keeping earlier locks, until 16 of 16.
  // Or, after the first try, lock every row that tells the parents apart (a hit stays, a miss flips; rows both parents draw
  // alike match either way and stay free): the feedback alone gives the whole dream, so the second egg always makes it real.
  const eggs: number[] = [], hearts: number[] = [], allHearts: number[] = [];
  let firstMatched = 0;
  samples.forEach(({ friend, dream }, index) => {
    let locks: RowLock[] = Array(FRAME_SIZE).fill(null), free = 3, spent = 0, count = 0, playId = BigInt(5000 + index * 20);
    const hatch = () => {
      const rows = locks.filter(lock => lock !== null).length, cost = lockCost(rows, free);
      free -= cost.free; spent += cost.hearts; count++; playId++;
      return stampDream(dream, hatchOf(friend, dream.mate, "common", playId, locks));
    };
    let baby = hatch();
    firstMatched += baby.dream!.matched;
    const all = baby.dream!.rows.map((hit, y) => dream.same[y] ? null : (hit ? baby.dna!.rowSource[y] : 1 - baby.dna!.rowSource[y]) as RowLock);
    assert.deepEqual(all, dream.mask.map((side, y) => dream.same[y] ? null : side), "the first feedback names every telling row");
    assert.equal(stampDream(dream, hatchOf(friend, dream.mate, "mutant", 99n, all)).dream!.matched, FRAME_SIZE, "the second egg makes it real");
    allHearts.push(lockCost(all.filter(lock => lock !== null).length, 3).hearts);
    while (baby.dream!.matched < FRAME_SIZE && count < 12) {
      const hits = baby.dream!.rows;
      locks = locks.map((lock, y) => hits[y] ? lock : dream.mask[y]);
      baby = hatch();
    }
    assert.equal(baby.dream!.matched, FRAME_SIZE);
    eggs.push(count); hearts.push(spent);
  });
  const average = (list: number[]) => list.reduce((sum, value) => sum + value, 0) / list.length;
  eggs.sort((x, y) => x - y);
  console.log(`  first try matches ${(firstMatched / samples.length).toFixed(1)} of 16 rows on average; locking the misses: ${average(eggs).toFixed(2)} eggs`
    + ` (median ${eggs[eggs.length >> 1]}, max ${eggs[eggs.length - 1]}), ${average(hearts).toFixed(1)} Hearts; locking every telling row after the first try:`
    + ` 2 eggs, ${average(allHearts).toFixed(1)} Hearts with the 3 free locks (${samples.length} dreams)`);
  assert.ok(average(eggs) <= 4.5 && eggs[eggs.length - 1] <= 8);
});
