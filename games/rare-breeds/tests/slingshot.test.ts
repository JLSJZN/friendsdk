// Moon Slingshot checks. Run from the SDK root: node --test "games/rare-breeds/tests/*.test.ts"
// Every published slingshot number is proven exactly: zone odds over all 10000 rolls, payouts in base
// units, 0.9x per launch, 0.79875 RF per egg, the 600 RF Moon Fund and its backing rule.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { RF, createGamePreview, defineChanceGame, expectedReward, maximumPrize, outcomeForRoll, parseChanceGame } from "../../../dist/game.js";
import { expectedValue, formatRF, maxPrize } from "../src/economy.ts";
import {
  LAUNCH_ZONES, MOON_FUND_START, expectedMultiplierBps, initialLedger, launchBlocker, launchExpectedValue, launchPayout,
  maxLaunchPayout, multiplierLabel, resolveLaunch, zoneForRoll, zoneInfo, type LaunchResult, type SlingshotLedger, slingshotNet,
} from "../src/slingshot.ts";
import { LAUNCH_ZONE_ORDER, TIER_ORDER, type LaunchZoneId, type TierId } from "../src/types.ts";

const definition = parseChanceGame(JSON.parse(await readFile(new URL("../game.json", import.meta.url), "utf8")));
const ROLLS = 10_000;
/** Sanctuary value of each tier, read from game.json (outcomeId = TIER_ORDER index + 1). */
const TIERS = TIER_ORDER.map((tier, index) => ({ tier, value: definition.outcomes[index].reward }));
const valueOf = (tier: TierId) => TIERS.find(row => row.tier === tier)!.value;
/** Hundredths of an RF in base units: cents(25n) = 0.25 RF. */
const cents = (hundredths: bigint) => hundredths * RF / 100n;
const withFund = (fund: bigint): SlingshotLedger => Object.freeze({ ...initialLedger(), fund });

/** Deterministic xorshift32; rejection sampling keeps every bucket in [0, n) equally likely. */
function seeded(seed: number) {
  let state = seed >>> 0 || 1;
  const word = () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state; };
  return (n = ROLLS) => {
    const limit = 2 ** 32 - 2 ** 32 % n;
    let value: number;
    do value = word(); while (value >= limit);
    return value % n;
  };
}

/** Bigint in [1, max] from a seeded source: 90 random bits reduced mod max (max <= 6 RF, about 2^63, so the bias is below 2^-26). */
const randomValue = (draw: (n?: number) => number, max: bigint) =>
  (BigInt(draw(2 ** 30)) << 60n | BigInt(draw(2 ** 30)) << 30n | BigInt(draw(2 ** 30))) % max + 1n;

/** The launch of a baby worth `value` written as an SDK chance game: price = value, reward = payout per zone. */
const launchGame = (value: bigint) => defineChanceGame({
  name: "Moon Slingshot", consumable: "Launch", price: value,
  outcomes: LAUNCH_ZONES.map(zone => ({ name: zone.label, chanceBps: zone.chanceBps, reward: launchPayout(value, zone.id) })),
});

/** The stake multiplier GameHost uses for every preview ledger, read from the shipped SDK runtime. */
async function previewStakeMultiplier() {
  const source = await readFile(new URL("../../../dist/game-host.js", import.meta.url), "utf8");
  const match = source.match(/createGamePreview\(definition, \{[^}]*stake: maximumPrize\(definition\) \* (\d+)n/);
  assert(match, "GameHost preview stake changed; update the Moon Fund review");
  return BigInt(match[1]);
}

/** Walk bookkeeping: rebuilds the ledger from first principles and compares it after every launch. */
function checkedWalk(start: SlingshotLedger) {
  let ledger = start, values = 0n, payouts = 0n, launches = 0, blocked = 0, best: LaunchResult | null = null;
  return {
    get ledger() { return ledger; },
    get launches() { return launches; },
    get blocked() { return blocked; },
    step(babyKey: string, value: bigint, roll: number) {
      const blocker = launchBlocker(ledger, value);
      assert.equal(blocker === "backing", ledger.fund < 10n * value, `${babyKey}: blocked exactly when fund < 10 x value`);
      if (blocker) { blocked++; assert.throws(() => resolveLaunch(ledger, babyKey, value, roll), RangeError); return; }
      const next = resolveLaunch(ledger, babyKey, value, roll);
      values += value; payouts += next.result.payout; launches++;
      if (!best || next.result.payout > best.payout) best = next.result;
      assert(next.result.payout <= 10n * value && 10n * value <= ledger.fund, `${babyKey}: payout <= 10 x value <= fund`);
      assert(next.ledger.fund >= 0n, `${babyKey}: fund went negative (${next.ledger.fund})`);
      assert.equal(next.ledger.fund, start.fund + values - payouts, `${babyKey}: fund = start + sum(values) - sum(payouts)`);
      assert.equal(next.ledger.winnings, start.winnings + payouts, `${babyKey}: winnings = sum(payouts)`);
      assert.equal(next.ledger.staked, start.staked + values, `${babyKey}: staked = sum(values)`);
      assert.equal(slingshotNet(next.ledger), next.ledger.winnings - next.ledger.staked);
      assert.equal(next.ledger.launches, start.launches + launches);
      assert.equal(next.ledger.best, best, `${babyKey}: best is the first launch with the highest payout`);
      ledger = next.ledger;
    },
  };
}

test("zone table: LAUNCH_ZONE_ORDER, integer chances totalling 10000 bps, rising multipliers, frozen", () => {
  assert.deepEqual(LAUNCH_ZONE_ORDER, ["pond", "haystack", "rooftop", "cloud", "orbit", "moon"]);
  assert.deepEqual(LAUNCH_ZONES.map(zone => zone.id), [...LAUNCH_ZONE_ORDER]);
  assert.deepEqual(LAUNCH_ZONES.map(zone => zone.chanceBps), [4000, 2400, 1800, 1200, 400, 200]);
  assert.deepEqual(LAUNCH_ZONES.map(zone => zone.multiplierBps), [0, 5000, 10_000, 20_000, 40_000, 100_000]);
  assert.equal(LAUNCH_ZONES.reduce((sum, zone) => sum + zone.chanceBps, 0), ROLLS);
  for (const [index, zone] of LAUNCH_ZONES.entries()) {
    assert(Number.isInteger(zone.chanceBps) && zone.chanceBps >= 1 && zone.chanceBps <= ROLLS, `${zone.id}: chance`);
    assert(Number.isInteger(zone.multiplierBps) && zone.multiplierBps >= 0, `${zone.id}: multiplier`);
    if (index > 0) assert(zone.multiplierBps > LAUNCH_ZONES[index - 1].multiplierBps, `${zone.id}: pays more than the zone before`);
    assert(zone.label.trim().length > 0 && zone.line.trim().length > 0, `${zone.id}: label and line`);
    assert(Object.isFrozen(zone), `${zone.id}: frozen`);
    assert.equal(zoneInfo(zone.id), zone);
  }
  assert.equal(new Set(LAUNCH_ZONES.map(zone => zone.label)).size, LAUNCH_ZONES.length);
  assert(Object.isFrozen(LAUNCH_ZONES));
  assert.throws(() => { (LAUNCH_ZONES[5] as { chanceBps: number }).chanceBps = ROLLS; }, TypeError);
  assert.throws(() => { (LAUNCH_ZONES as unknown as unknown[]).push({}); }, TypeError);
  assert.equal(LAUNCH_ZONES[5].chanceBps, 200);
  assert.throws(() => zoneInfo("mars" as LaunchZoneId), RangeError);
});

test("every one of the 10000 rolls: zone counts equal chanceBps, the mean multiplier is exactly 0.9x", () => {
  const counts = new Map<LaunchZoneId, number>();
  let multiplierSum = 0, previous = 0;
  for (let roll = 0; roll < ROLLS; roll++) {
    const zone = zoneForRoll(roll), index = LAUNCH_ZONE_ORDER.indexOf(zone);
    assert(index >= previous, `roll ${roll}: zones are contiguous, nearest first`);
    previous = index;
    counts.set(zone, (counts.get(zone) ?? 0) + 1);
    multiplierSum += zoneInfo(zone).multiplierBps;
  }
  for (const zone of LAUNCH_ZONES) assert.equal(counts.get(zone.id), zone.chanceBps, zone.id);
  assert.equal(multiplierSum, 9000 * ROLLS, "sum of multipliers over all rolls = 0.9x per roll, no rounding");
  assert.equal(expectedMultiplierBps(), 9000);
  assert.equal(multiplierLabel(expectedMultiplierBps()), "x0.9");
});

test("each tier: the payouts over all 10000 rolls average exactly 0.9 x its value", () => {
  const expected: Record<TierId, bigint> = { common: cents(45n), spotted: cents(90n), mutant: cents(135n), prismatic: cents(540n) };
  for (const { tier, value } of TIERS) {
    let total = 0n;
    for (let roll = 0; roll < ROLLS; roll++) total += launchPayout(value, zoneForRoll(roll));
    assert.equal(total, 9000n * value, `${tier}: sum over rolls = 0.9 x value x 10000`);
    assert.equal(total % BigInt(ROLLS), 0n, `${tier}: no rounding`);
    assert.equal(launchExpectedValue(value), total / BigInt(ROLLS), tier);
    assert.equal(launchExpectedValue(value), expected[tier], tier);
  }
  assert.deepEqual(TIERS.map(({ value }) => formatRF(launchExpectedValue(value))), ["0.45 RF", "0.9 RF", "1.35 RF", "5.4 RF"]);
  // Any value: the exact weighted sum rounds down once, to floor(0.9 x value).
  const draw = seeded(3);
  for (const value of [1n, 9n, 10n, 11n, 19n, ...Array.from({ length: 500 }, () => randomValue(draw, 6n * RF))]) {
    assert.equal(launchExpectedValue(value), 9n * value / 10n, `value ${value}`);
  }
});

test("roll boundaries map to the right zone; invalid rolls throw", () => {
  const cases: [number, LaunchZoneId][] = [
    [0, "pond"], [3999, "pond"], [4000, "haystack"], [6399, "haystack"], [6400, "rooftop"], [8199, "rooftop"],
    [8200, "cloud"], [9399, "cloud"], [9400, "orbit"], [9799, "orbit"], [9800, "moon"], [9999, "moon"],
  ];
  for (const [roll, zone] of cases) assert.equal(zoneForRoll(roll), zone, `roll ${roll}`);
  for (const roll of [-1, ROLLS, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => zoneForRoll(roll), RangeError, `roll ${roll}`);
});

test("payout table: exact base units for every tier and zone, x10 at most", () => {
  // Hundredths of an RF, zones in LAUNCH_ZONE_ORDER: pond x0, haystack x0.5, rooftop x1, cloud x2, orbit x4, moon x10.
  const table: Record<TierId, bigint[]> = {
    common: [0n, 25n, 50n, 100n, 200n, 500n],
    spotted: [0n, 50n, 100n, 200n, 400n, 1000n],
    mutant: [0n, 75n, 150n, 300n, 600n, 1500n],
    prismatic: [0n, 300n, 600n, 1200n, 2400n, 6000n],
  };
  for (const { tier, value } of TIERS) {
    for (const [index, zone] of LAUNCH_ZONES.entries()) {
      assert.equal(launchPayout(value, zone.id), cents(table[tier][index]), `${tier} ${zone.id}`);
      assert.equal(value * BigInt(zone.multiplierBps) % BigInt(ROLLS), 0n, `${tier} ${zone.id}: exact, nothing rounded`);
    }
    assert.equal(maxLaunchPayout(value), launchPayout(value, "moon"));
    assert.equal(maxLaunchPayout(value), 10n * value);
  }
  assert.equal(launchPayout(6n * RF, "moon"), 60n * RF, "Prismatic on the Moon");
  assert.equal(launchPayout(RF / 2n, "haystack"), RF / 4n, "Common in the haystack");
  assert.equal(launchPayout(3n * RF / 2n, "cloud"), 3n * RF, "Mutant on cloud nine");
  assert.equal(launchPayout(RF, "pond"), 0n, "the pond keeps everything");
  assert.deepEqual(LAUNCH_ZONE_ORDER.map(zone => formatRF(launchPayout(valueOf("prismatic"), zone))), ["0 RF", "3 RF", "6 RF", "12 RF", "24 RF", "60 RF"]);
  assert.deepEqual(LAUNCH_ZONE_ORDER.map(zone => formatRF(launchPayout(valueOf("common"), zone))), ["0 RF", "0.25 RF", "0.5 RF", "1 RF", "2 RF", "5 RF"]);
  assert.deepEqual(LAUNCH_ZONES.map(zone => multiplierLabel(zone.multiplierBps)), ["x0", "x0.5", "x1", "x2", "x4", "x10"]);
  assert.deepEqual([12_500, 1200, 1, 250_000].map(multiplierLabel), ["x1.25", "x0.12", "x0.0001", "x25"]);
  // Base units round down, in the fund's favour: 1 base unit in the haystack pays nothing.
  assert.equal(launchPayout(1n, "haystack"), 0n);
  assert.equal(launchPayout(3n, "haystack"), 1n);
});

test("the launch table is a valid SDK chance game for every tier (same rolls, EV and max prize)", () => {
  for (const { tier, value } of TIERS) {
    const game = launchGame(value);
    assert.equal(expectedReward(game), launchExpectedValue(value), `${tier}: SDK expectedReward`);
    assert.equal(maximumPrize(game), maxLaunchPayout(value), `${tier}: SDK maximumPrize`);
    for (let roll = 0; roll < ROLLS; roll++) {
      if (outcomeForRoll(game, roll) !== LAUNCH_ZONE_ORDER.indexOf(zoneForRoll(roll)) + 1) assert.fail(`${tier} roll ${roll}: SDK outcomeForRoll disagrees`);
    }
  }
});

test("Moon Fund starts at 600 RF: 10 x the highest Moon payout, the SDK preview-stake convention", async () => {
  const multiplier = await previewStakeMultiplier();
  assert.equal(multiplier, 10n);
  assert.equal(maxPrize(definition), 6n * RF);
  assert.equal(maxLaunchPayout(maxPrize(definition)), 60n * RF, "Prismatic on the Moon");
  assert.equal(MOON_FUND_START, 10n * maxLaunchPayout(maxPrize(definition)));
  assert.equal(MOON_FUND_START, multiplier * maxLaunchPayout(maximumPrize(definition)));
  assert.equal(MOON_FUND_START, 600n * RF);
  const ledger = initialLedger();
  assert.deepEqual(ledger, { fund: 600n * RF, winnings: 0n, staked: 0n, launches: 0, best: null });
  assert(Object.isFrozen(ledger));
  assert.notEqual(initialLedger(), ledger, "a fresh ledger per session");
  for (const { tier, value } of TIERS) assert.equal(launchBlocker(ledger, value), null, `${tier} flies from the first second`);
});

test("launchBlocker: worthless babies, the exact 10 x value backing edge", () => {
  assert.equal(launchBlocker(initialLedger(), 0n), "worthless");
  assert.equal(launchBlocker(initialLedger(), -RF), "worthless");
  assert.equal(launchBlocker(withFund(0n), 0n), "worthless", "worthless wins over backing");
  for (const { tier, value } of TIERS) {
    assert.equal(launchBlocker(withFund(10n * value), value), null, `${tier}: fund exactly 10 x value`);
    assert.equal(launchBlocker(withFund(10n * value - 1n), value), "backing", `${tier}: one base unit short`);
    assert.equal(launchBlocker(withFund(0n), value), "backing", `${tier}: empty fund`);
  }
  assert.equal(launchBlocker(withFund(10n), 1n), null);
  assert.equal(launchBlocker(withFund(9n), 1n), "backing");
});

test("launchBlocker is the SDK canBuy rule for a launch game backed by the fund", async () => {
  for (const { tier, value } of TIERS) {
    for (const fund of [0n, 10n * value - 1n, 10n * value, 10n * value + 1n, 9n * value, MOON_FUND_START]) {
      const { client } = createGamePreview(launchGame(value), { stake: fund, rfBalance: 1000n * RF });
      assert.equal(await client.canBuy(1n), launchBlocker(withFund(fund), value) === null, `${tier} with fund ${formatRF(fund)}`);
    }
  }
});

test("the SDK preview ledger books every launch exactly like resolveLaunch", async () => {
  const draw = seeded(42);
  for (const { tier, value } of TIERS) {
    let roll = 0, ledger = initialLedger(), launches = 0;
    const { client } = createGamePreview(launchGame(value), { stake: MOON_FUND_START, rfBalance: 1_000_000n * RF, draw: () => roll });
    // 300 fair launches, then Moon after Moon until the fund refuses: both ledgers must agree on every step.
    for (;;) {
      roll = launches < 300 ? draw() : 9999;
      const allowed = launchBlocker(ledger, value) === null;
      assert.equal(await client.canBuy(1n), allowed, `${tier} launch ${launches}: same backing verdict`);
      if (!allowed) break;
      await client.buy(1n);
      const [play] = await client.play(1n);
      const { outcomeId } = await client.settle(play.id);
      const next = resolveLaunch(ledger, `baby:${launches}`, value, roll);
      assert.equal(outcomeId, LAUNCH_ZONE_ORDER.indexOf(next.result.zone) + 1);
      assert.equal((await client.read()).freeStake, next.ledger.fund, `${tier} launch ${launches}: freeStake = fund`);
      if (next.result.payout > 0n) await client.redeem(outcomeId!, 1n);
      const snapshot = await client.read();
      assert.equal(snapshot.stake, next.ledger.fund);
      assert.equal(snapshot.freeStake, next.ledger.fund, "paying out does not change the free fund");
      ledger = next.ledger;
      launches++;
    }
    assert(launches > 300, `${tier}: ${launches} launches before the Moon run was refused`);
    assert(ledger.fund < 10n * value);
    await assert.rejects(client.buy(1n));
  }
});

test("resolveLaunch books fund, winnings, launches and best; the input ledger never changes", () => {
  const start = initialLedger();
  const first = resolveLaunch(start, "baby:1", valueOf("prismatic"), 9800);
  assert.deepEqual(first.result, { babyKey: "baby:1", zone: "moon", value: 6n * RF, payout: 60n * RF, roll: 9800 });
  assert.deepEqual(first.ledger, { fund: 546n * RF, winnings: 60n * RF, staked: 6n * RF, launches: 1, best: first.result });
  assert.equal(slingshotNet(first.ledger), 54n * RF);
  assert.equal(first.ledger.best, first.result);
  assert(Object.isFrozen(first) && Object.isFrozen(first.result) && Object.isFrozen(first.ledger));
  assert.deepEqual(start, initialLedger(), "input ledger unchanged");
  const firstLedger = { ...first.ledger };

  const second = resolveLaunch(first.ledger, "baby:2", valueOf("common"), 6400);
  assert.deepEqual(second.result, { babyKey: "baby:2", zone: "rooftop", value: RF / 2n, payout: RF / 2n, roll: 6400 });
  assert.deepEqual(second.ledger, { fund: 546n * RF, winnings: cents(6050n), staked: cents(650n), launches: 2, best: first.result });
  const third = resolveLaunch(second.ledger, "baby:3", valueOf("mutant"), 0);
  assert.deepEqual(third.result, { babyKey: "baby:3", zone: "pond", value: 3n * RF / 2n, payout: 0n, roll: 0 });
  assert.deepEqual(third.ledger, { fund: cents(54_750n), winnings: cents(6050n), staked: cents(800n), launches: 3, best: first.result });
  assert.equal(slingshotNet(third.ledger), cents(5250n));
  assert.deepEqual(first.ledger, firstLedger, "earlier ledgers unchanged");

  // Ties keep the earlier launch; only a strictly higher payout replaces it.
  const a = resolveLaunch(initialLedger(), "baby:a", valueOf("spotted"), 8200);
  const b = resolveLaunch(a.ledger, "baby:b", valueOf("common"), 9400);
  assert.equal(a.result.payout, 2n * RF);
  assert.equal(b.result.payout, 2n * RF);
  assert.equal(b.ledger.best, a.result, "tie keeps the earlier result");
  const c = resolveLaunch(b.ledger, "baby:c", valueOf("common"), 9800);
  assert.equal(c.ledger.best, c.result, "5 RF beats 2 RF");
  const pond = resolveLaunch(initialLedger(), "baby:p", RF, 0);
  assert.equal(pond.ledger.best, pond.result, "a first pond landing is the best so far");
  assert.equal(resolveLaunch(pond.ledger, "baby:q", RF, 1).ledger.best, pond.result);
});

test("resolveLaunch refuses blocked launches and invalid rolls without touching the ledger", () => {
  const short = withFund(60n * RF - 1n), snapshot = { ...short };
  assert.throws(() => resolveLaunch(short, "baby:x", valueOf("prismatic"), 0), { name: "RangeError", message: /cannot cover/ });
  assert.throws(() => resolveLaunch(initialLedger(), "baby:x", 0n, 0), { name: "RangeError", message: /no value/ });
  assert.throws(() => resolveLaunch(initialLedger(), "baby:x", RF, ROLLS), RangeError);
  assert.throws(() => resolveLaunch(initialLedger(), "baby:x", RF, 0.5), RangeError);
  assert.deepEqual(short, snapshot);
  assert.equal(resolveLaunch(withFund(60n * RF), "baby:x", valueOf("prismatic"), 9999).ledger.fund, 6n * RF, "exactly backed: fund 60 + 6 - 60");
});

test("worst case: 11 Prismatic Moon landings in a row leave 6 RF, and the first 11 launches can never be blocked", () => {
  // Largest possible drain per launch: value - payout >= -54 RF, only for a Prismatic on the Moon.
  let drain = 0n;
  for (const { value } of TIERS) for (const zone of LAUNCH_ZONE_ORDER) {
    const loss = launchPayout(value, zone) - value;
    if (loss > drain) drain = loss;
    if (loss === 54n * RF) assert.equal(value * 10n, 60n * RF);
  }
  assert.equal(drain, 54n * RF);
  // Before launch 11 at most 10 launches have drained the fund: 600 - 10 x 54 = 60 = 10 x the top value.
  assert.equal(MOON_FUND_START - 10n * drain, maxLaunchPayout(maxPrize(definition)));
  let ledger = initialLedger(), launches = 0;
  while (!launchBlocker(ledger, valueOf("prismatic"))) { ledger = resolveLaunch(ledger, `baby:${launches}`, valueOf("prismatic"), 9999).ledger; launches++; }
  assert.equal(launches, 11);
  assert.equal(ledger.fund, 6n * RF, "600 + 11 x (6 - 60) RF");
  assert.equal(ledger.winnings, 660n * RF);
  assert.deepEqual(TIER_ORDER.map(tier => launchBlocker(ledger, valueOf(tier))), [null, "backing", "backing", "backing"], "only Commons (Moon 5 RF) still fly");
});

test("fund never goes negative: 200000 fair launches and 200000 rigged ones, full accounting every step", () => {
  // By construction: payout <= maxLaunchPayout = 10 x value <= fund, so fund' = fund - payout + value >= value > 0.
  const draw = seeded(7730);
  for (let index = 0; index < 2000; index++) {
    const value = randomValue(draw, 6n * RF);
    for (const zone of LAUNCH_ZONE_ORDER) assert(launchPayout(value, zone) <= maxLaunchPayout(value));
    assert.equal(maxLaunchPayout(value), 10n * value);
  }
  // Fair: egg-weighted tiers, fair rolls, from the 600 RF start.
  const fair = checkedWalk(initialLedger());
  for (let index = 0; index < 200_000; index++) {
    const tier = definition.outcomes[outcomeForRoll(definition, draw()) - 1];
    fair.step(`fair:${index}`, tier.reward, draw());
  }
  assert.equal(fair.launches, 200_000, "a fair session never hits the backing rule");
  // Rigged: every launch lands on cloud, orbit or the Moon (x2 or more), any value up to 6 RF. The fund drains fast.
  const rigged = checkedWalk(initialLedger());
  for (let index = 0; index < 200_000; index++) {
    const value = index % 2 ? TIERS[draw(TIERS.length)].value : randomValue(draw, 6n * RF);
    rigged.step(`rigged:${index}`, value, 8200 + draw(1800));
  }
  assert(rigged.launches > 0 && rigged.blocked > 0, `rigged walk: ${rigged.launches} launched, ${rigged.blocked} refused`);
  assert(rigged.ledger.fund >= 0n && rigged.ledger.fund < MOON_FUND_START);
});

test("launching every baby returns exactly 0.79875 RF per 1 RF egg (egg EV 0.8875 x 0.9)", () => {
  // Exhaustive over the joint space of 10000 egg rolls x 10000 launch rolls, factored per tier.
  const perTier = definition.outcomes.map(outcome => {
    let total = 0n;
    for (let roll = 0; roll < ROLLS; roll++) total += launchPayout(outcome.reward, zoneForRoll(roll));
    return total;
  });
  let total = 0n;
  for (let roll = 0; roll < ROLLS; roll++) total += perTier[outcomeForRoll(definition, roll) - 1];
  assert.equal(total, 79_875_000n * RF, "10^8 equally likely (egg, launch) pairs pay 0.79875 RF each on average");
  assert.equal(total % BigInt(ROLLS * ROLLS), 0n, "no rounding");
  const combined = definition.outcomes.reduce((sum, outcome) => sum + launchExpectedValue(outcome.reward) * BigInt(outcome.chanceBps), 0n) / BigInt(ROLLS);
  assert.equal(combined, total / BigInt(ROLLS * ROLLS));
  assert.equal(combined, 798_750_000_000_000_000n);
  assert.equal(expectedValue(definition), 887_500_000_000_000_000n);
  assert.equal(combined, expectedValue(definition) * BigInt(expectedMultiplierBps()) / BigInt(ROLLS));
  assert.equal(combined, expectedReward(definition) * 9n / 10n);
  assert.equal(formatRF(combined), "0.79875 RF");
  assert.equal(combined * 100_000n / definition.price, 79_875n, "79.875% of the egg price");
});

test("Monte Carlo sanity: 1,000,000 seeded rolls average 0.9x (+/- 0.01), zone shares within 0.2 points", () => {
  const draw = seeded(20_260_926), counts = new Map<LaunchZoneId, number>(), samples = 1_000_000;
  let multiplierSum = 0;
  for (let index = 0; index < samples; index++) {
    const zone = zoneForRoll(draw());
    counts.set(zone, (counts.get(zone) ?? 0) + 1);
    multiplierSum += zoneInfo(zone).multiplierBps;
  }
  const mean = multiplierSum / samples / ROLLS;
  assert(Math.abs(mean - 0.9) <= 0.01, `empirical mean multiplier ${mean}`);
  for (const zone of LAUNCH_ZONES) {
    const share = (counts.get(zone.id) ?? 0) / samples;
    assert(Math.abs(share - zone.chanceBps / ROLLS) <= 0.002, `${zone.id}: ${share}`);
  }
});
