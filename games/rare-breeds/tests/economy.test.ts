// Economy checks for Rare Breeds. Run from the SDK root: node --test games/rare-breeds/tests/
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { RF, createGamePreview, expectedReward, maximumPrize, outcomeForRoll, parseChanceGame } from "../../../dist/game.js";
import {
  describeTiers, expectedValue, expectedValueLabel, formatChance, formatOdds, formatRF, maxPrize,
  outcomeForTier, purchaseBlocker, tierForOutcome,
} from "../src/economy.ts";
import { TIER_ORDER, TIER_STYLE } from "../src/types.ts";
import { formatGameAmount } from "../../../dist/experience-ui.js";

const definition = parseChanceGame(JSON.parse(await readFile(new URL("../game.json", import.meta.url), "utf8")));

/** The preview ledger GameHost creates for every verified Friend, read from the shipped SDK runtime. */
async function previewLedgerTerms() {
  const source = await readFile(new URL("../../../dist/game-host.js", import.meta.url), "utf8");
  const match = source.match(/createGamePreview\(definition, \{[^}]*stake: maximumPrize\(definition\) \* (\d+)n, rfBalance: (\d+)n \* RF \}/);
  assert(match, "GameHost preview ledger terms changed; update the economy review");
  return { stakeMultiplier: BigInt(match[1]), rfBalance: BigInt(match[2]) * RF };
}

async function previewLedger(draw: () => number) {
  const terms = await previewLedgerTerms();
  return createGamePreview(definition, { friendId: 7730n, stake: maximumPrize(definition) * terms.stakeMultiplier, rfBalance: terms.rfBalance, draw }).client;
}

/** Hatch until the ledger refuses the next egg. keep(outcomeId) decides keep (true) or Sanctuary (false). */
async function session(draw: () => number, keep: (outcomeId: number) => boolean, limit = 10_000) {
  const client = await previewLedger(draw);
  let hatches = 0;
  while (hatches < limit) {
    const before = await client.read();
    if (before.rfBalance < definition.price || !(await client.canBuy(1n))) break;
    await client.buy(1n);
    const [play] = await client.play(1n);
    const settled = await client.settle(play.id);
    hatches++;
    if (!keep(settled.outcomeId!)) await client.redeem(settled.outcomeId!, 1n);
  }
  return { hatches, snapshot: await client.read() };
}

/** First roll in [0, 10000) that lands on outcomeId. */
const rollFor = (outcomeId: number) => {
  for (let roll = 0; roll < 10_000; roll++) if (outcomeForRoll(definition, roll) === outcomeId) return roll;
  throw new Error("unreachable");
};

function seeded(seed: number) {
  let state = seed >>> 0 || 1;
  return () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state % 10_000; };
}

test("game.json parses with the SDK schema and has the agreed identity", () => {
  assert.equal(definition.name, "Rare Breeds");
  assert.equal(definition.consumable, "Egg");
  assert.equal(definition.price, RF, "an egg costs exactly 1 RF");
  assert.equal(definition.price, 1_000_000_000_000_000_000n);
});

test("four outcomes in TIER_ORDER, weights sum to 10000 bps", () => {
  assert.equal(definition.outcomes.length, TIER_ORDER.length);
  assert.deepEqual(definition.outcomes.map(outcome => outcome.name), TIER_ORDER.map(tier => `${TIER_STYLE[tier].label} hatchling`));
  assert.equal(definition.outcomes.reduce((sum, outcome) => sum + outcome.chanceBps, 0), 10_000);
  assert.deepEqual(definition.outcomes.map(outcome => outcome.chanceBps), [6000, 2500, 1250, 250]);
  assert.deepEqual(definition.outcomes.map(outcome => outcome.reward), [5n * RF / 10n, RF, 15n * RF / 10n, 6n * RF]);
  TIER_ORDER.forEach((tier, index) => { assert.equal(tierForOutcome(index + 1), tier); assert.equal(outcomeForTier(tier), index + 1); });
});

test("rarity shape: Common is the majority, Prismatic is 2-3% and the top prize", () => {
  const [common, spotted, mutant, prismatic] = definition.outcomes;
  assert(common.chanceBps > 5000);
  assert(common.chanceBps > spotted.chanceBps && spotted.chanceBps > mutant.chanceBps && mutant.chanceBps > prismatic.chanceBps);
  assert(prismatic.chanceBps >= 200 && prismatic.chanceBps <= 300);
  assert(common.reward < spotted.reward && spotted.reward < mutant.reward && mutant.reward < prismatic.reward);
  assert.equal(maximumPrize(definition), prismatic.reward);
});

test("expected value is 0.8875 RF per egg, inside 0.85 to 0.92 RF", () => {
  const ev = expectedReward(definition);
  assert.equal(ev, 887_500_000_000_000_000n);
  assert.equal(expectedValue(definition), ev, "economy.ts matches the SDK formula");
  assert(ev >= 85n * RF / 100n && ev <= 92n * RF / 100n);
  // Exhaustive over every contract roll: no rounding slack.
  let total = 0n;
  for (let roll = 0; roll < 10_000; roll++) total += definition.outcomes[outcomeForRoll(definition, roll) - 1].reward;
  assert.equal(total, 8875n * RF);
  assert.equal(expectedValueLabel(definition), "0.8875 RF per egg (88.75% of the 1 RF price)");
});

test("roll boundaries map to the right tier (fixture roll 1500 is Common)", () => {
  const cases: [number, number][] = [[0, 1], [5999, 1], [6000, 2], [8499, 2], [8500, 3], [9749, 3], [9750, 4], [9999, 4], [1500, 1]];
  for (const [roll, outcomeId] of cases) assert.equal(outcomeForRoll(definition, roll), outcomeId, `roll ${roll}`);
});

test("preview stake backs the max prize from the first second", async () => {
  const terms = await previewLedgerTerms();
  assert.equal(terms.stakeMultiplier, 10n);
  assert.equal(terms.rfBalance, 20n * RF);
  const max = maximumPrize(definition);
  assert.equal(max, 6n * RF);
  assert.equal(maxPrize(definition), max);
  const client = await previewLedger(() => rollFor(1));
  const first = await client.read();
  assert.equal(first.stake, 60n * RF);
  assert.equal(first.freeStake, 60n * RF);
  assert(first.freeStake >= max && first.freeStake + definition.price >= max, "starter canBuy rule");
  assert.equal(await client.canBuy(1n), true);
  assert.equal(purchaseBlocker(first, definition), null);
  await client.buy(1n);
  const bought = await client.read();
  assert.equal(bought.reservedPlays, max, "every purchased egg reserves the maximum prize");
  assert.equal(bought.freeStake, 55n * RF);
});

test("worst case: purchases pause only after 11 Prismatic hatches in a row", async () => {
  const { hatches, snapshot } = await session(() => rollFor(4), () => true);
  assert.equal(hatches, 11);
  assert.equal(snapshot.freeStake, 5n * RF, "60 + 11 x (1 - 6) RF");
  assert.equal(purchaseBlocker(snapshot, definition), "backing");
  // Selling does not free backing: kept rewards and redemptions both leave free stake unchanged.
  const sold = await session(() => rollFor(4), () => false);
  assert.equal(sold.hatches, 11);
  assert.equal(sold.snapshot.rfBalance, 20n * RF - 11n * RF + 66n * RF);
});

test("unhatched eggs share the preview backing: 12 in one buy, or 11 one at a time", async () => {
  const bulk = await previewLedger(() => rollFor(1));
  assert.equal(await bulk.canBuy(12n), true);
  assert.equal(await bulk.canBuy(13n), false);
  const single = await previewLedger(() => rollFor(1));
  let eggs = 0;
  while (await single.canBuy(1n)) { await single.buy(1n); eggs++; }
  assert.equal(eggs, 11);
  assert.equal((await single.read()).freeStake, 5n * RF, "60 + 11 x (1 - 6) RF");
});

test("hatch budget from the 20 RF preview balance", async () => {
  // Keep every baby: exactly one hatch per RF, whatever the tiers.
  assert.equal((await session(seeded(1), () => true)).hatches, 20);
  // Sell every baby, worst luck (all Common, 0.5 RF back): guaranteed minimum.
  const allCommon = await session(() => rollFor(1), () => false);
  assert.equal(allCommon.hatches, 39);
  assert.equal(allCommon.snapshot.rfBalance, RF / 2n);
  // Sell only Commons, keep the rest: at least the 20 kept-everything hatches.
  assert.equal((await session(() => rollFor(2), outcomeId => outcomeId !== 1)).hatches, 20);
  const mixed = await session(seeded(7730), outcomeId => outcomeId !== 1);
  assert(mixed.hatches >= 20, `sell-commons strategy hatched ${mixed.hatches}`);
});

test("describeTiers combines the runtime definition with TIER_STYLE", () => {
  const rows = describeTiers(definition);
  assert.deepEqual(rows.map(row => [row.tier, row.outcomeId, row.label, row.chancePercent, row.odds, row.rewardLabel]), [
    ["common", 1, "Common", "60%", "3 in 5", "0.5 RF"],
    ["spotted", 2, "Spotted", "25%", "1 in 4", "1 RF"],
    ["mutant", 3, "Mutant", "12.5%", "1 in 8", "1.5 RF"],
    ["prismatic", 4, "Prismatic", "2.5%", "1 in 40", "6 RF"],
  ]);
  for (const row of rows) {
    assert.equal(row.name, definition.outcomes[row.outcomeId - 1].name);
    assert.equal(row.reward, definition.outcomes[row.outcomeId - 1].reward);
    assert.equal(row.chanceBps, definition.outcomes[row.outcomeId - 1].chanceBps);
    assert.equal(row.accent, TIER_STYLE[row.tier].accent);
    assert(row.description.length > 0);
  }
  assert.throws(() => describeTiers({ ...definition, outcomes: definition.outcomes.slice(0, 3) }), RangeError);
});

test("tier lookups reject unknown values", () => {
  for (const id of [0, 5, 1.5, Number.NaN]) assert.throws(() => tierForOutcome(id), RangeError);
  assert.throws(() => outcomeForTier("golden" as never), RangeError);
});

test("formatRF trims zeros and stays exact", () => {
  const cases: [bigint, string][] = [
    [RF, "1 RF"], [RF / 2n, "0.5 RF"], [1225n * RF / 100n, "12.25 RF"], [0n, "0 RF"], [6n * RF, "6 RF"],
    [887_500_000_000_000_000n, "0.8875 RF"], [1n, "0.000000000000000001 RF"], [-RF / 4n, "-0.25 RF"],
    [123_456n * RF + 10n ** 17n, "123,456.1 RF"], [999n * RF, "999 RF"], [1000n * RF, "1,000 RF"],
  ];
  for (const [amount, label] of cases) assert.equal(formatRF(amount), label);
  // Same text as the runtime confirmation amounts.
  for (const [amount] of cases) if (amount >= 0n) assert.equal(formatRF(amount), `${formatGameAmount(amount, 18)} RF`);
});

test("chance and odds labels", () => {
  assert.deepEqual([6000, 2500, 1250, 250, 25, 10_000, 1].map(formatChance), ["60%", "25%", "12.5%", "2.5%", "0.25%", "100%", "0.01%"]);
  assert.deepEqual([6000, 2500, 250, 1150].map(formatOdds), ["3 in 5", "1 in 4", "1 in 40", "about 1 in 9"]);
});

test("purchaseBlocker mirrors the ledger rule", () => {
  assert.equal(purchaseBlocker({ rfBalance: RF / 2n, freeStake: 60n * RF }, definition), "balance");
  assert.equal(purchaseBlocker({ rfBalance: RF, freeStake: 6n * RF }, definition), null);
  assert.equal(purchaseBlocker({ rfBalance: RF, freeStake: 6n * RF - 1n }, definition), "backing");
  assert.equal(purchaseBlocker({ rfBalance: 20n * RF, freeStake: 60n * RF }, definition, 12n), null);
  assert.equal(purchaseBlocker({ rfBalance: 20n * RF, freeStake: 60n * RF }, definition, 13n), "backing");
});
