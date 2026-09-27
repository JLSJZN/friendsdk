// Moon Slingshot checks. Run from the SDK root: node --test "games/rare-breeds/tests/*.test.ts"
// Every published slingshot number is proven exactly: the crash point over all 10000 rolls (10% fizzle, 9% Moon,
// P(C >= h) = floor(900000 / h) / 10000 for every h), at most 0.9x back for every exit from x1 to x10, payouts in
// base units rounded down, the multiplier curve, the 600 RF Moon Fund and its backing rule.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { RF, createGamePreview, defineChanceGame, expectedReward, maximumPrize, outcomeForRoll, parseChanceGame } from "../../../dist/game.js";
import { expectedValue, formatRF, maxPrize } from "../src/economy.ts";
import {
  FIZZLE_BPS, FLIGHT_MS, LADDER_EXITS, MAX_RETURN_BPS, MOON_FUND_START, MOON_HUNDREDTHS, START_HUNDREDTHS, crashPoint, exitExpectedValue, exitPayout,
  createFlightDesk, flightHundredths, initialLedger, launchBlocker, maxLaunchPayout, msToReach, multiplierLabel, reachBps, resolveLaunch, slingshotNet,
  type LaunchResult, type SlingshotLedger,
} from "../src/slingshot.ts";
import { TIER_ORDER, type TierId } from "../src/types.ts";

const definition = parseChanceGame(JSON.parse(await readFile(new URL("../game.json", import.meta.url), "utf8")));
const ROLLS = 10_000;
/** Sanctuary value of each tier, read from game.json (outcomeId = TIER_ORDER index + 1). */
const TIERS = TIER_ORDER.map((tier, index) => ({ tier, value: definition.outcomes[index].reward }));
const valueOf = (tier: TierId) => TIERS.find(row => row.tier === tier)!.value;
/** Hundredths of an RF in base units: cents(25n) = 0.25 RF. */
const cents = (hundredths: bigint) => hundredths * RF / 100n;
const withFund = (fund: bigint): SlingshotLedger => Object.freeze({ ...initialLedger(), fund });
/** Every exit a player can take, x1.00 to x10.00. */
const EXITS = Array.from({ length: MOON_HUNDREDTHS - START_HUNDREDTHS + 1 }, (_, index) => START_HUNDREDTHS + index);
/** The first roll of the Moon (crash point x10) and of the fizzle (below x1). */
const MOON_ROLL = 0, FIZZLE_ROLL = 9000;

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

/** Crash-point histogram over all 10000 rolls, and how many rolls reach each h (reach[h] = rolls with C >= h). */
const histogram = new Array<number>(MOON_HUNDREDTHS + 1).fill(0);
for (let roll = 0; roll < ROLLS; roll++) histogram[crashPoint(roll)]++;
const reach = new Array<number>(MOON_HUNDREDTHS + 2).fill(0);
for (let h = MOON_HUNDREDTHS; h >= 0; h--) reach[h] = reach[h + 1] + histogram[h];

/** Always jumping at `exit` written as an SDK chance game: price = the stake, outcome 1 = the jump pays, outcome 2 = the pond. */
const exitGame = (value: bigint, exit: number) => defineChanceGame({
  name: "Moon Slingshot", consumable: "Launch", price: value,
  outcomes: [
    { name: `Jump at ${multiplierLabel(exit)}`, chanceBps: reachBps(exit), reward: exitPayout(value, exit) },
    { name: "Pond", chanceBps: ROLLS - reachBps(exit), reward: 0n },
  ],
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
  let ledger = start, values = 0n, payouts = 0n, launches = 0, blocked = 0, best: LaunchResult | null = null, top = start.topExit;
  return {
    get ledger() { return ledger; },
    get launches() { return launches; },
    get blocked() { return blocked; },
    step(babyKey: string, value: bigint, roll: number, exit: number | null) {
      const blocker = launchBlocker(ledger, value);
      assert.equal(blocker === "backing", ledger.fund < 10n * value, `${babyKey}: blocked exactly when fund < 10 x value`);
      if (blocker) { blocked++; assert.throws(() => resolveLaunch(ledger, babyKey, value, roll, exit), RangeError); return; }
      const next = resolveLaunch(ledger, babyKey, value, roll, exit);
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
      assert.equal(next.result.record, (next.result.exit ?? 0) > top, `${babyKey}: a record beats every earlier exit`);
      top = Math.max(top, next.result.exit ?? 0);
      assert.equal(next.ledger.topExit, top, `${babyKey}: topExit is the highest exit so far`);
      ledger = next.ledger;
    },
  };
}

test("constants and the exits ladder: x1.5 60%, x2 45%, x4 22.5%, Moon x10 9%, fizzle 10%", () => {
  assert.equal(START_HUNDREDTHS, 100);
  assert.equal(MOON_HUNDREDTHS, 1000);
  assert.equal(FLIGHT_MS, 9000);
  assert.equal(MAX_RETURN_BPS, 9000);
  assert.deepEqual(LADDER_EXITS, [150, 200, 400, 1000]);
  assert(Object.isFrozen(LADDER_EXITS));
  assert.throws(() => { (LADDER_EXITS as number[]).push(2000); }, TypeError);
  assert.deepEqual(LADDER_EXITS.map(reachBps), [6000, 4500, 2250, 900]);
  assert.equal(FIZZLE_BPS, 1000);
  assert.equal(reachBps(START_HUNDREDTHS), 9000, "90% of rockets leave the pad");
  assert.deepEqual(LADDER_EXITS.map(exit => multiplierLabel(exit)), ["x1.5", "x2", "x4", "x10"]);
  assert.deepEqual([0, 90, 100, 237, 1000].map(h => multiplierLabel(h, true)), ["x0.00", "x0.90", "x1.00", "x2.37", "x10.00"]);
  assert.deepEqual([0, 90, 105, 120].map(h => multiplierLabel(h)), ["x0", "x0.9", "x1.05", "x1.2"]);
  assert.equal(multiplierLabel(MAX_RETURN_BPS / 100), "x0.9");
  for (const exit of [99, 1001, 150.5, Number.NaN, 0]) assert.throws(() => reachBps(exit), RangeError, `exit ${exit}`);
});

test("every one of the 10000 rolls: 1000 fizzle on the pad, 900 reach the Moon, crash points 90 to 1000, never rising", () => {
  let previous = Infinity;
  for (let roll = 0; roll < ROLLS; roll++) {
    const crash = crashPoint(roll);
    assert.equal(crash, Math.min(1000, Math.floor(900_000 / (roll + 1))), `roll ${roll}`);
    assert(crash <= previous, `roll ${roll}: the crash point never rises with the roll`);
    previous = crash;
  }
  assert.equal(histogram.slice(0, START_HUNDREDTHS).reduce((sum, count) => sum + count, 0), 1000, "fizzle: crash point below x1");
  assert.equal(histogram[MOON_HUNDREDTHS], 900, "Moon: crash point x10");
  assert.equal(reach[0], ROLLS);
  assert.equal(crashPoint(0), 1000);
  assert.equal(crashPoint(899), 1000, "the last Moon roll");
  assert.equal(crashPoint(900), 998);
  assert.equal(crashPoint(8999), 100, "the last roll that leaves the pad");
  assert.equal(crashPoint(9000), 99, "the first fizzle");
  assert.equal(crashPoint(9999), 90);
  assert.equal(histogram.findIndex(count => count > 0), 90, "lowest crash point x0.90");
  for (const roll of [-1, ROLLS, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => crashPoint(roll), RangeError, `roll ${roll}`);
});

test("P(crash point >= h) = floor(900000 / h) / 10000 exactly, for every h from x0.01 to x10", () => {
  for (let h = 1; h <= MOON_HUNDREDTHS; h++) {
    assert.equal(reach[h], Math.min(ROLLS, Math.floor(900_000 / h)), `h ${h}`);
    if (h >= START_HUNDREDTHS) assert.equal(reachBps(h), reach[h], `reachBps(${h})`);
  }
  // The rolls that reach h are exactly 0 .. reach - 1, so the chance is also a cumulative weight, like the SDK's outcomeForRoll.
  for (const h of [100, 101, 150, 199, 200, 237, 333, 400, 599, 999, 1000]) {
    assert(crashPoint(reachBps(h) - 1) >= h && crashPoint(reachBps(h)) < h, `h ${h}: rolls below reachBps win`);
  }
  assert.equal(reach[150] / ROLLS, 0.6);
  assert.equal(reach[200] / ROLLS, 0.45);
  assert.equal(reach[400] / ROLLS, 0.225);
  assert.equal(reach[1000] / ROLLS, 0.09);
});

test("every exit from x1.00 to x10.00 returns at most 0.9x on average, exactly 0.9x at the ladder's round exits", () => {
  let lowest = { h: 0, ev: 1 };
  for (const h of EXITS) {
    // Exact over all 10000 rolls: the jump pays value x h / 100 on the reach[h] rolls whose rocket gets there.
    assert(h * reach[h] <= 900_000, `x${h / 100}: ${h * reach[h]} > 900000`);
    const ev = h * reach[h] / (100 * ROLLS);
    if (ev < lowest.ev) lowest = { h, ev };
    for (const { tier, value } of TIERS) {
      const total = BigInt(reach[h]) * exitPayout(value, h);
      assert(total * 10n <= 9n * value * BigInt(ROLLS), `${tier} x${h / 100}: more than 0.9x back`);
      assert.equal(exitExpectedValue(value, h), value * BigInt(h * reach[h]) / BigInt(100 * ROLLS), `${tier} x${h / 100}`);
    }
  }
  assert(lowest.ev > 0.899, `worst exit x${lowest.h / 100} still returns ${lowest.ev}`);
  for (const h of [100, 120, 125, 150, 200, 250, 300, 400, 450, 500, 600, 750, 900, 1000]) {
    assert.equal(h * reach[h], 900_000, `x${h / 100} divides 900000: exactly 0.9x`);
    for (const { value } of TIERS) assert.equal(exitExpectedValue(value, h), 9n * value / 10n);
  }
  assert.deepEqual(TIERS.map(({ value }) => formatRF(exitExpectedValue(value, 200))), ["0.45 RF", "0.9 RF", "1.35 RF", "5.4 RF"]);
});

test("resolveLaunch over all 10000 rolls: the ladder exits pay what the exact table says", () => {
  for (const { tier, value } of TIERS) {
    for (const exit of [...LADDER_EXITS, 100, 237, null]) {
      let total = 0n, wins = 0;
      for (let roll = 0; roll < ROLLS; roll++) {
        const { result } = resolveLaunch(initialLedger(), "baby", value, roll, exit);
        total += result.payout;
        if (result.payout > 0n) wins++;
      }
      const at = exit ?? MOON_HUNDREDTHS;
      assert.equal(wins, reachBps(at), `${tier} ${exit}: wins`);
      assert.equal(total, BigInt(reachBps(at)) * exitPayout(value, at), `${tier} ${exit}: total`);
    }
  }
});

test("payout table: exact base units for every tier at the ladder exits, x10 at most, rounding down", () => {
  // Hundredths of an RF at x1.5, x2, x4, x10.
  const table: Record<TierId, bigint[]> = {
    common: [75n, 100n, 200n, 500n],
    spotted: [150n, 200n, 400n, 1000n],
    mutant: [225n, 300n, 600n, 1500n],
    prismatic: [900n, 1200n, 2400n, 6000n],
  };
  for (const { tier, value } of TIERS) {
    for (const [index, exit] of LADDER_EXITS.entries()) assert.equal(exitPayout(value, exit), cents(table[tier][index]), `${tier} x${exit / 100}`);
    assert.equal(maxLaunchPayout(value), 10n * value);
    assert.equal(exitPayout(value, 237) * 100n, value * 237n, `${tier}: x2.37 is exact in base units`);
  }
  assert.equal(formatRF(exitPayout(RF / 2n, 237)), "1.185 RF", "Common at x2.37");
  assert.equal(exitPayout(1n, 150), 1n, "1.5 base units round down to 1");
  assert.equal(exitPayout(7n, 150), 10n, "10.5 -> 10");
  assert.equal(exitPayout(3n, 237), 7n, "7.11 -> 7");
  assert.equal(exitPayout(1n, 199), 1n);
  assert.equal(exitPayout(1n, 1000), 10n);
  const odd = resolveLaunch(initialLedger(), "baby:odd", 7n, 0, 150);
  assert.equal(odd.result.payout, 10n, "resolveLaunch rounds down in the fund's favour");
  assert.equal(odd.ledger.fund, MOON_FUND_START + 7n - 10n);
});

test("the multiplier curve: x1 at ignition, 10^(t / 9 s) in whole hundredths, never falling, x10 at exactly 9 s", () => {
  assert.equal(flightHundredths(0), 100);
  for (const ms of [-1, -1000, Number.NaN, Number.NEGATIVE_INFINITY]) assert.equal(flightHundredths(ms), 100, `ms ${ms}`);
  assert.equal(flightHundredths(8999), 999);
  assert.equal(flightHundredths(9000), 1000);
  for (const ms of [9000.5, 20_000, Number.POSITIVE_INFINITY]) assert.equal(flightHundredths(ms), 1000);
  const k = Math.LN10 / FLIGHT_MS;
  let previous = 100;
  for (let step = 0; step <= 4 * FLIGHT_MS; step++) {
    const ms = step / 4, value = flightHundredths(ms);
    assert(value >= previous, `ms ${ms}: ${value} < ${previous}`);
    assert(value <= 100 * Math.exp(k * ms) + 1e-9 && value > 100 * Math.exp(k * ms) - 1, `ms ${ms}: floor(100 e^(kt))`);
    previous = value;
  }
  assert.deepEqual([150, 200, 400, 1000].map(msToReach), [1585, 2710, 5419, 9000], "x1.5 at 1.6 s, x2 at 2.7 s, x4 at 5.4 s, x10 at 9 s");
  for (const h of EXITS) {
    const ms = msToReach(h);
    assert(flightHundredths(ms) >= h && (ms === 0 || flightHundredths(ms - 1) < h), `msToReach(${h}) = ${ms}`);
  }
  assert.equal(msToReach(100), 0);
});

test("resolveLaunch: a jump at or below the crash point wins, one hundredth above loses; held to the end is the Moon or the pond", () => {
  const value = valueOf("spotted"), start = initialLedger();
  const roll = 2638, crash = crashPoint(roll);
  assert.equal(crash, 341, "x3.41");
  const at = (exit: number | null, r = roll) => resolveLaunch(start, "baby:1", value, r, exit).result;
  assert.deepEqual(at(crash), { babyKey: "baby:1", value, roll, crash: 341, end: "jump", exit: 341, payout: cents(341n), record: true });
  assert.deepEqual(at(237), { babyKey: "baby:1", value, roll, crash: 341, end: "jump", exit: 237, payout: cents(237n), record: true });
  assert.deepEqual(at(crash + 1), { babyKey: "baby:1", value, roll, crash: 341, end: "crash", exit: null, payout: 0n, record: false });
  assert.deepEqual(at(null), { babyKey: "baby:1", value, roll, crash: 341, end: "crash", exit: null, payout: 0n, record: false });
  assert.deepEqual(at(null, MOON_ROLL), { babyKey: "baby:1", value, roll: 0, crash: 1000, end: "moon", exit: 1000, payout: 10n * value, record: true });
  assert.deepEqual(at(1000, 899), { babyKey: "baby:1", value, roll: 899, crash: 1000, end: "moon", exit: 1000, payout: 10n * value, record: true });
  assert.equal(at(999, 899).end, "jump", "a jump just below x10 is still a jump");
  assert.equal(at(1000, 900).end, "crash", "x9.98 cannot reach x10");
  for (const exit of [100, 150, 1000, null]) {
    for (const r of [FIZZLE_ROLL, 9500, 9999]) assert.deepEqual(at(exit, r), { babyKey: "baby:1", value, roll: r, crash: crashPoint(r), end: "fizzle", exit: null, payout: 0n, record: false });
  }
  assert.equal(at(100, 8999).end, "jump", "x1.00 on the last roll that leaves the pad pays the stake back");
  assert.equal(at(100, 8999).payout, value);
});

test("resolveLaunch books fund, winnings, launches and best; the input ledger never changes", () => {
  const start = initialLedger();
  const first = resolveLaunch(start, "baby:1", valueOf("prismatic"), MOON_ROLL, null);
  assert.deepEqual(first.result, { babyKey: "baby:1", value: 6n * RF, roll: 0, crash: 1000, end: "moon", exit: 1000, payout: 60n * RF, record: true });
  assert.deepEqual(first.ledger, { fund: 546n * RF, winnings: 60n * RF, staked: 6n * RF, launches: 1, best: first.result, topExit: 1000 });
  assert.equal(slingshotNet(first.ledger), 54n * RF);
  assert(Object.isFrozen(first) && Object.isFrozen(first.result) && Object.isFrozen(first.ledger));
  assert.deepEqual(start, initialLedger(), "input ledger unchanged");
  const firstLedger = { ...first.ledger };

  const second = resolveLaunch(first.ledger, "baby:2", valueOf("common"), 4000, 200);
  assert.deepEqual(second.result, { babyKey: "baby:2", value: RF / 2n, roll: 4000, crash: 224, end: "jump", exit: 200, payout: RF, record: false });
  assert.deepEqual(second.ledger, { fund: cents(54_550n), winnings: 61n * RF, staked: cents(650n), launches: 2, best: first.result, topExit: 1000 });
  const third = resolveLaunch(second.ledger, "baby:3", valueOf("mutant"), FIZZLE_ROLL, 150);
  assert.deepEqual(third.result, { babyKey: "baby:3", value: 3n * RF / 2n, roll: 9000, crash: 99, end: "fizzle", exit: null, payout: 0n, record: false });
  assert.deepEqual(third.ledger, { fund: cents(54_700n), winnings: 61n * RF, staked: cents(800n), launches: 3, best: first.result, topExit: 1000 });
  assert.equal(slingshotNet(third.ledger), cents(5300n));
  assert.deepEqual(first.ledger, firstLedger, "earlier ledgers unchanged");

  // Ties keep the earlier launch; only a strictly higher payout replaces it.
  const a = resolveLaunch(initialLedger(), "baby:a", valueOf("spotted"), 0, 200);
  const b = resolveLaunch(a.ledger, "baby:b", valueOf("common"), 0, 400);
  assert.equal(a.result.payout, 2n * RF);
  assert.equal(b.result.payout, 2n * RF);
  assert.equal(b.ledger.best, a.result, "tie keeps the earlier result");
  const c = resolveLaunch(b.ledger, "baby:c", valueOf("common"), 0, null);
  assert.equal(c.ledger.best, c.result, "5 RF beats 2 RF");
});

test("records: topExit keeps the highest exit; a result is a record only when it beats it, and the pond never is", () => {
  let ledger = initialLedger();
  const fly = (roll: number, exit: number | null) => { const next = resolveLaunch(ledger, "baby:r", RF, roll, exit); ledger = next.ledger; return next.result; };
  assert.equal(fly(9500, 150).record, false, "a fizzle is no record");
  assert.equal(ledger.topExit, 0);
  assert.equal(fly(0, 237).record, true, "the first jump sets the first record");
  assert.equal(fly(0, 237).record, false, "matching it is not a record");
  assert.equal(fly(0, 150).record, false);
  assert.equal(fly(4000, null).record, false, "a crash is no record");
  assert.equal(ledger.topExit, 237);
  assert.equal(fly(0, null).record, true, "the Moon beats x2.37");
  assert.equal(ledger.topExit, 1000);
});

test("flight desk: one draw per flight, booked once; no second rocket lights while one is in the air", () => {
  let ledger = initialLedger(), draws = 0;
  const rolls = [1500, 0];
  const desk = createFlightDesk(() => ledger, next => { ledger = next; }, () => rolls[draws++]);
  assert.equal(desk.settle(150), null, "nothing in the air: nothing booked");
  assert.equal(desk.ignite("baby:1", RF), crashPoint(1500));
  assert.equal(desk.ignite("baby:1", RF), crashPoint(1500), "asking again returns the same crash point, without a new draw");
  assert.equal(desk.ignite("baby:2", RF), null, "another baby waits until this flight is booked");
  assert.equal(draws, 1);
  assert.ok(desk.flying);
  const result = desk.settle(200)!;
  assert.deepEqual([result.end, result.exit, result.payout], ["jump", 200, 2n * RF]);
  assert.equal(ledger.launches, 1);
  assert.equal(desk.flying, false);
  assert.equal(desk.settle(300), null, "booked once");
  assert.equal(desk.ignite("baby:2", RF), crashPoint(0), "the next rocket lights once the last one is booked");
  assert.equal(desk.settle(null)!.end, "moon");
  // Blocked: the fund cannot cover the Moon payout, so nothing is drawn.
  ledger = withFund(10n * RF - 1n);
  assert.equal(desk.ignite("baby:3", RF), null);
  assert.equal(draws, 2);
  assert.equal(desk.flying, false);
});

test("determinism: the same roll and exit always give the same result; the ledger is the only state", () => {
  const draw = seeded(11);
  for (let index = 0; index < 2000; index++) {
    const value = TIERS[draw(TIERS.length)].value, roll = draw(), exit = draw(3) ? EXITS[draw(EXITS.length)] : null;
    const once = resolveLaunch(initialLedger(), `baby:${index}`, value, roll, exit), twice = resolveLaunch(initialLedger(), `baby:${index}`, value, roll, exit);
    assert.deepEqual(once, twice);
    assert.equal(once.result.crash, crashPoint(roll));
  }
});

test("resolveLaunch refuses blocked launches, invalid rolls and invalid exits without touching the ledger", () => {
  const short = withFund(60n * RF - 1n), snapshot = { ...short };
  assert.throws(() => resolveLaunch(short, "baby:x", valueOf("prismatic"), 0, 150), { name: "RangeError", message: /cannot cover/ });
  assert.throws(() => resolveLaunch(initialLedger(), "baby:x", 0n, 0, 150), { name: "RangeError", message: /no value/ });
  assert.throws(() => resolveLaunch(initialLedger(), "baby:x", RF, ROLLS, 150), RangeError);
  assert.throws(() => resolveLaunch(initialLedger(), "baby:x", RF, 0.5, 150), RangeError);
  for (const exit of [99, 1001, 150.5, Number.NaN, -100]) assert.throws(() => resolveLaunch(initialLedger(), "baby:x", RF, 0, exit), RangeError, `exit ${exit}`);
  assert.deepEqual(short, snapshot);
  assert.equal(resolveLaunch(withFund(60n * RF), "baby:x", valueOf("prismatic"), MOON_ROLL, null).ledger.fund, 6n * RF, "exactly backed: fund 60 + 6 - 60");
});

test("Moon Fund starts at 600 RF: 10 x the highest Moon payout, the SDK preview-stake convention", async () => {
  const multiplier = await previewStakeMultiplier();
  assert.equal(multiplier, 10n);
  assert.equal(maxPrize(definition), 6n * RF);
  assert.equal(maxLaunchPayout(maxPrize(definition)), 60n * RF, "Prismatic on the Moon");
  assert.equal(MOON_FUND_START, multiplier * maxLaunchPayout(maximumPrize(definition)));
  assert.equal(MOON_FUND_START, 600n * RF);
  const ledger = initialLedger();
  assert.deepEqual(ledger, { fund: 600n * RF, winnings: 0n, staked: 0n, launches: 0, best: null, topExit: 0 });
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

test("each exit is a valid SDK chance game (same winning rolls, EV and prize); the Moon ride's max prize is the backing rule", async () => {
  for (const { tier, value } of TIERS) {
    for (const exit of [...LADDER_EXITS, 100, 237]) {
      const game = exitGame(value, exit);
      assert.equal(expectedReward(game), exitExpectedValue(value, exit), `${tier} x${exit / 100}: SDK expectedReward`);
      assert.equal(maximumPrize(game), exitPayout(value, exit), `${tier} x${exit / 100}: SDK maximumPrize`);
      for (let roll = 0; roll < ROLLS; roll++) {
        const won = resolveLaunch(initialLedger(), "baby", value, roll, exit).result.payout > 0n;
        if (outcomeForRoll(game, roll) !== (won ? 1 : 2)) assert.fail(`${tier} x${exit / 100} roll ${roll}: SDK outcomeForRoll disagrees`);
      }
    }
    // Riding to the Moon pays the most a launch can pay, so its SDK canBuy rule is exactly launchBlocker.
    for (const fund of [0n, 10n * value - 1n, 10n * value, 10n * value + 1n, 9n * value, MOON_FUND_START]) {
      const { client } = createGamePreview(exitGame(value, MOON_HUNDREDTHS), { stake: fund, rfBalance: 1000n * RF });
      assert.equal(await client.canBuy(1n), launchBlocker(withFund(fund), value) === null, `${tier} with fund ${formatRF(fund)}`);
    }
  }
});

test("the SDK preview ledger books every launch exactly like resolveLaunch", async () => {
  const draw = seeded(42);
  for (const { tier, value } of TIERS) {
    for (const exit of LADDER_EXITS) {
      let roll = 0, ledger = initialLedger(), launches = 0;
      const { client } = createGamePreview(exitGame(value, exit), { stake: MOON_FUND_START, rfBalance: 1_000_000n * RF, draw: () => roll });
      // 200 fair launches, then winning roll after winning roll until the SDK or the slingshot refuses.
      for (;;) {
        roll = launches < 200 ? draw() : 0;
        const allowed = launchBlocker(ledger, value) === null;
        if (exit === MOON_HUNDREDTHS) assert.equal(await client.canBuy(1n), allowed, `${tier} launch ${launches}: same backing verdict`);
        if (!allowed || !(await client.canBuy(1n))) break;
        await client.buy(1n);
        const [play] = await client.play(1n);
        const { outcomeId } = await client.settle(play.id);
        const next = resolveLaunch(ledger, `baby:${launches}`, value, roll, exit);
        assert.equal(outcomeId, next.result.payout > 0n ? 1 : 2);
        assert.equal((await client.read()).freeStake, next.ledger.fund, `${tier} x${exit / 100} launch ${launches}: freeStake = fund`);
        if (next.result.payout > 0n) await client.redeem(outcomeId!, 1n);
        assert.equal((await client.read()).stake, next.ledger.fund);
        ledger = next.ledger;
        launches++;
      }
      assert(launches > 200, `${tier} x${exit / 100}: ${launches} launches`);
    }
  }
});

test("worst case: 11 Prismatic Moon landings in a row leave 6 RF, and the first 11 launches can never be blocked", () => {
  // Largest possible drain per launch: payout - value <= 9 x value = 54 RF, only for a Prismatic on the Moon.
  let drain = 0n;
  for (const { value } of TIERS) for (const exit of EXITS) if (exitPayout(value, exit) - value > drain) drain = exitPayout(value, exit) - value;
  assert.equal(drain, 54n * RF);
  assert.equal(MOON_FUND_START - 10n * drain, maxLaunchPayout(maxPrize(definition)), "before launch 11 at most 10 launches drained 54 RF each");
  let ledger = initialLedger(), launches = 0;
  while (!launchBlocker(ledger, valueOf("prismatic"))) { ledger = resolveLaunch(ledger, `baby:${launches}`, valueOf("prismatic"), MOON_ROLL, null).ledger; launches++; }
  assert.equal(launches, 11);
  assert.equal(ledger.fund, 6n * RF, "600 + 11 x (6 - 60) RF");
  assert.equal(ledger.winnings, 660n * RF);
  assert.deepEqual(TIER_ORDER.map(tier => launchBlocker(ledger, valueOf(tier))), [null, "backing", "backing", "backing"], "only Commons (Moon 5 RF) still fly");
});

test("fund never goes negative: 200000 fair launches and 200000 rigged ones, full accounting every step", () => {
  // By construction: payout <= 10 x value <= fund, so fund' = fund - payout + value >= value > 0.
  const draw = seeded(7730);
  for (let index = 0; index < 2000; index++) {
    const value = randomValue(draw, 6n * RF);
    for (const exit of [100, 150, 999, 1000]) assert(exitPayout(value, exit) <= maxLaunchPayout(value));
    assert.equal(maxLaunchPayout(value), 10n * value);
  }
  // Fair: egg-weighted tiers, fair rolls, a random exit (a third ride to the end).
  const fair = checkedWalk(initialLedger());
  for (let index = 0; index < 200_000; index++) {
    const tier = definition.outcomes[outcomeForRoll(definition, draw()) - 1];
    fair.step(`fair:${index}`, tier.reward, draw(), draw(3) ? EXITS[draw(EXITS.length)] : null);
  }
  assert.equal(fair.launches, 200_000, "a fair session never hits the backing rule");
  // Rigged: every rocket reaches the Moon and every exit wins, any value up to 6 RF. The fund drains fast.
  const rigged = checkedWalk(initialLedger());
  for (let index = 0; index < 200_000; index++) {
    const value = index % 2 ? TIERS[draw(TIERS.length)].value : randomValue(draw, 6n * RF);
    rigged.step(`rigged:${index}`, value, draw(900), draw(2) ? 600 + draw(401) : null);
  }
  assert(rigged.launches > 0 && rigged.blocked > 0, `rigged walk: ${rigged.launches} launched, ${rigged.blocked} refused`);
  assert(rigged.ledger.fund >= 0n && rigged.ledger.fund < MOON_FUND_START);
});

test("launching every baby and jumping at a round exit returns exactly 0.79875 RF per 1 RF egg (0.8875 x 0.9)", () => {
  for (const exit of LADDER_EXITS) {
    // Exhaustive over the joint space of 10000 egg rolls x 10000 crash rolls, factored per tier.
    const perTier = definition.outcomes.map(outcome => BigInt(reach[exit]) * exitPayout(outcome.reward, exit));
    let total = 0n;
    for (let roll = 0; roll < ROLLS; roll++) total += perTier[outcomeForRoll(definition, roll) - 1];
    assert.equal(total, 79_875_000n * RF, `x${exit / 100}: 10^8 equally likely (egg, crash) pairs pay 0.79875 RF each on average`);
    assert.equal(total % BigInt(ROLLS * ROLLS), 0n, "no rounding");
  }
  const combined = definition.outcomes.reduce((sum, outcome) => sum + exitExpectedValue(outcome.reward, 200) * BigInt(outcome.chanceBps), 0n) / BigInt(ROLLS);
  assert.equal(combined, 798_750_000_000_000_000n);
  assert.equal(expectedValue(definition), 887_500_000_000_000_000n);
  assert.equal(combined, expectedReward(definition) * BigInt(MAX_RETURN_BPS) / BigInt(ROLLS));
  assert.equal(formatRF(combined), "0.79875 RF");
  assert.equal(combined * 100_000n / definition.price, 79_875n, "79.875% of the egg price");
});

test("Monte Carlo sanity: 1,000,000 seeded rolls: 10% fizzle, 9% Moon, x2 jumps return 0.9x (+/- 0.01)", () => {
  const draw = seeded(20_260_926), samples = 1_000_000;
  let fizzles = 0, moons = 0, paid = 0;
  for (let index = 0; index < samples; index++) {
    const crash = crashPoint(draw());
    if (crash < START_HUNDREDTHS) fizzles++;
    if (crash === MOON_HUNDREDTHS) moons++;
    if (crash >= 200) paid += 2;
  }
  assert(Math.abs(fizzles / samples - 0.1) <= 0.002, `fizzle share ${fizzles / samples}`);
  assert(Math.abs(moons / samples - 0.09) <= 0.002, `Moon share ${moons / samples}`);
  assert(Math.abs(paid / samples - 0.9) <= 0.01, `x2 mean payback ${paid / samples}`);
});
