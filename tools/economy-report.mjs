#!/usr/bin/env node
// Print the exact economy terms of a CLI game plus a Monte Carlo run of the SDK's own preview ledger.
//   node tools/economy-report.mjs [game-directory] [--sessions 5000] [--seed 7730]
// Uses parseChanceGame / expectedReward / maximumPrize / createGamePreview from dist/game.js and reads
// the preview stake and balance from the shipped runtime (dist/game-host.js), so nothing is assumed.
// Games with src/slingshot.ts (Rare Breeds) also get the Moon Slingshot section: the exact exits table (crash
// odds and payouts), the Moon Fund backing rule and a Monte Carlo of launching every baby per exit strategy.
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { RF, createGamePreview, expectedReward, maximumPrize, outcomeForRoll } from "../dist/game.js";
import { formatGameAmount } from "../dist/experience-ui.js";
import { DEFAULT_GAME, SDK_ROOT, readDefinition, relativeToRoot } from "./lib/runtime.mjs";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { sessions: { type: "string" }, seed: { type: "string" } } });
const gameDirectory = resolve(positionals[0] ?? DEFAULT_GAME);
const sessions = Number(values.sessions ?? 5000), seed = Number(values.seed ?? 7730);
const definition = await readDefinition(gameDirectory);
const rf = value => `${formatGameAmount(value, 18)} RF`;

const host = await readFile(join(SDK_ROOT, "dist/game-host.js"), "utf8");
const terms = host.match(/stake: maximumPrize\(definition\) \* (\d+)n, rfBalance: (\d+)n \* RF/);
assert(terms, "Preview ledger terms not found in dist/game-host.js");
const multiplier = BigInt(terms[1]), balance = BigInt(terms[2]) * RF;
const max = maximumPrize(definition), ev = expectedReward(definition), stake = max * multiplier;

console.log(`# ${definition.name} economy (${relativeToRoot(gameDirectory)}/game.json)\n`);
console.log(`Consumable: ${definition.consumable}, price ${rf(definition.price)} (${definition.price} base units)\n`);
console.log("| outcomeId | Outcome | Weight (bps) | Chance | Reward | Reward base units | EV share |");
console.log("| --- | --- | ---: | ---: | ---: | ---: | ---: |");
let start = 0;
for (const [index, outcome] of definition.outcomes.entries()) {
  const share = outcome.reward * BigInt(outcome.chanceBps) / 10_000n;
  console.log(`| ${index + 1} | ${outcome.name} | ${outcome.chanceBps} | ${outcome.chanceBps / 100}% | ${rf(outcome.reward)} | ${outcome.reward} | ${rf(share)} |`);
  assert.equal(outcomeForRoll(definition, start), index + 1);
  start += outcome.chanceBps;
}
console.log(`| | **Total** | ${start} | 100% | | | **${rf(ev)}** |\n`);
console.log(`Expected value: sum(reward x bps) / 10000 = ${rf(ev)} per ${definition.consumable.toLowerCase()} (${Number(ev * 10_000n / definition.price) / 100}% return, ${Number((definition.price - ev) * 10_000n / definition.price) / 100}% house edge)`);
console.log(`Maximum prize (reserved per purchased or pending ${definition.consumable.toLowerCase()}): ${rf(max)}`);
console.log(`Preview ledger (GameHost): stake = maximumPrize x ${multiplier} = ${rf(stake)}, RF balance = ${rf(balance)}`);
console.log(`First purchase: freeStake ${rf(stake)} >= max prize ${rf(max)} and freeStake + price ${rf(stake + definition.price)} >= ${rf(max)}: ${stake >= max && stake + definition.price >= max}`);
const worst = (stake - max) / (max - definition.price) + 1n;
console.log(`Backing pause: freeStake after n settled plays = ${rf(stake)} + sum(price - reward); purchases stop below ${rf(max)}.`);
console.log(`  Worst case (every play pays the max prize): pause after ${worst} consecutive max prizes (p = ${((definition.outcomes.find(outcome => outcome.reward === max).chanceBps / 10_000) ** Number(worst)).toExponential(2)}).`);
console.log(`  Redemption moves RF from stake to the player and releases the same liability: freeStake is unchanged by selling.`);

// Monte Carlo over the SDK's own preview ledger.
function random(seedValue) {
  let state = seedValue >>> 0 || 1;
  return () => {
    let word;
    do { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; word = state; } while (word >= 4_294_960_000);
    return word % 10_000;
  };
}
async function play(draw, keep) {
  const { client } = createGamePreview(definition, { friendId: 7730n, stake, rfBalance: balance, draw });
  let hatches = 0, paused = false, kept = 0;
  for (;;) {
    const snapshot = await client.read();
    if (snapshot.rfBalance < definition.price) break;
    if (!(await client.canBuy(1n))) { paused = true; break; }
    await client.buy(1n);
    const [entry] = await client.play(1n);
    const { outcomeId } = await client.settle(entry.id);
    hatches++;
    if (keep(outcomeId)) kept++; else await client.redeem(outcomeId, 1n);
  }
  return { hatches, paused, kept };
}
const strategies = [
  ["keep every baby", () => true],
  ["sell Commons, keep the rest", outcomeId => outcomeId !== 1],
  ["sell every baby", () => false],
];
console.log(`\nMonte Carlo: ${sessions} sessions per strategy on createGamePreview (seed ${seed}), each from ${rf(balance)} until the player cannot afford an egg\n`);
console.log("| Strategy | Min hatches | p5 | Median | Mean | Max | Backing pauses |");
console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
const hatchesByStrategy = new Map();
for (const [name, keep] of strategies) {
  const draw = random(seed), results = [];
  let pauses = 0;
  for (let index = 0; index < sessions; index++) { const result = await play(draw, keep); results.push(result.hatches); if (result.paused) pauses++; }
  results.sort((a, b) => a - b);
  hatchesByStrategy.set(name, results);
  const mean = results.reduce((sum, value) => sum + value, 0) / results.length;
  console.log(`| ${name} | ${results[0]} | ${results[Math.floor(results.length * 0.05)]} | ${results[Math.floor(results.length / 2)]} | ${mean.toFixed(1)} | ${results.at(-1)} | ${pauses} |`);
}
const chance = id => definition.outcomes[id - 1].chanceBps / 10_000;
const atLeastOne = (p, n) => 1 - (1 - p) ** n;
console.log(`\nIn 20 hatches: P(at least one ${definition.outcomes.at(-1).name}) = ${(atLeastOne(chance(definition.outcomes.length), 20) * 100).toFixed(1)}%, ` +
  `P(at least one of the top two tiers) = ${(atLeastOne(chance(definition.outcomes.length) + chance(definition.outcomes.length - 1), 20) * 100).toFixed(1)}%`);

// Moon Slingshot (Rare Breeds only): a simulated side ledger in src/slingshot.ts, proven in tests/slingshot.test.ts.
const slingshotPath = join(gameDirectory, "src/slingshot.ts");
if (await stat(slingshotPath).then(() => true, () => false)) await slingshotReport(await import(pathToFileURL(slingshotPath).href));

async function slingshotReport({
  FIZZLE_BPS, LADDER_EXITS, MAX_RETURN_BPS, MOON_FUND_START, MOON_HUNDREDTHS, START_HUNDREDTHS, crashPoint, exitExpectedValue, exitPayout,
  initialLedger, launchBlocker, maxLaunchPayout, msToReach, multiplierLabel, reachBps, resolveLaunch, slingshotNet,
}) {
  const bps = 10_000n, item = definition.consumable.toLowerCase();
  const order = (a, b) => a < b ? -1 : a > b ? 1 : 0, about = value => `${(Number(value) / Number(RF)).toFixed(3)} RF`;
  console.log(`\n## Moon Slingshot (${relativeToRoot(slingshotPath)}, simulated side ledger)\n`);
  console.log("A launch first trades the baby in through the SDK (client.redeem: tier token burned, its fixed value lands in the spendable RF balance); that value is the stake. " +
    "The baby then rides a rocket like the casino game Crash: while the player holds, the multiplier climbs as 10^(t / 9 s); letting go jumps at floor(m x 100) / 100. " +
    "One roll in 0-9999, drawn at ignition, fixes the crash point C = floor(900000 / (roll + 1)) hundredths (capped at x10): a jump at h pays stake x h when C >= h, else x0 (the pond); x10 jumps onto the Moon by itself. " +
    "The side ledger books only payout - stake (the net); it is not spendable.\n");
  // Exact over all 10000 rolls: how many reach each exit.
  const reach = new Map();
  for (let roll = 0; roll < 10_000; roll++) { const crash = crashPoint(roll); reach.set(crash, (reach.get(crash) ?? 0) + 1); }
  const reaching = h => [...reach].reduce((sum, [crash, count]) => sum + (crash >= h ? count : 0), 0);
  const fizzles = 10_000 - reaching(START_HUNDREDTHS);
  assert.equal(fizzles, FIZZLE_BPS, "fizzle rolls");
  const exits = [START_HUNDREDTHS, ...LADDER_EXITS];
  console.log(`| Exit | Rolls | Chance | Reached after | EV (x stake) | ${definition.outcomes.map(outcome => outcome.name.replace(/ hatchling$/, "")).join(" | ")} |`);
  console.log(`| --- | --- | ---: | ---: | ---: | ${definition.outcomes.map(() => "---:").join(" | ")} |`);
  console.log(`| Fizzles on the pad (x0) | ${10_000 - FIZZLE_BPS}-9999 | ${FIZZLE_BPS / 100}% | at ignition | x0 | ${definition.outcomes.map(() => rf(0n)).join(" | ")} |`);
  for (const h of exits) {
    const rolls = reaching(h);
    assert.equal(rolls, reachBps(h), `reach x${h / 100}`);
    assert.equal(rolls, Math.floor(900_000 / h), `P(C >= ${h}) = floor(900000 / h) / 10000`);
    const label = h === MOON_HUNDREDTHS ? `Moon, auto jump (${multiplierLabel(h)})` : `Jump at ${multiplierLabel(h)}`;
    console.log(`| ${label} | 0-${rolls - 1} | ${rolls / 100}% | ${(Math.round(msToReach(h) / 10) / 100).toFixed(2)} s | ${multiplierLabel(h * rolls / 10_000)} | ${definition.outcomes.map(outcome => rf(exitPayout(outcome.reward, h))).join(" | ")} |`);
  }
  let worst = { h: 0, back: Infinity };
  for (let h = START_HUNDREDTHS; h <= MOON_HUNDREDTHS; h++) {
    const back = h * reaching(h);
    assert(back <= 100 * MAX_RETURN_BPS, `x${h / 100} returns more than x0.9`);
    if (back < worst.back) worst = { h, back };
  }
  const combined = definition.outcomes.reduce((sum, outcome) => sum + exitExpectedValue(outcome.reward, 200) * BigInt(outcome.chanceBps), 0n) / bps;
  assert.equal(combined, ev * BigInt(MAX_RETURN_BPS) / bps, "launch EV composes with the egg EV");
  const top = maxLaunchPayout(max), fundStart = top * multiplier;
  assert.equal(MOON_FUND_START, fundStart, "Moon Fund follows the preview-stake convention");
  const drain = definition.outcomes.reduce((worstDrain, outcome) => {
    const loss = maxLaunchPayout(outcome.reward) - outcome.reward;
    return loss > worstDrain ? loss : worstDrain;
  }, 0n);
  const safe = (MOON_FUND_START - top) / drain + 1n;
  let fastest = initialLedger(), fastestLaunches = 0;
  while (!launchBlocker(fastest, max)) { fastest = resolveLaunch(fastest, "worst", max, 0, null).ledger; fastestLaunches++; }
  const stillFly = definition.outcomes.filter(outcome => !launchBlocker(fastest, outcome.reward)).map(outcome => outcome.name);

  console.log(`\nExpected payback of always jumping at h: h x floor(900000 / h) / 10^6 <= x${MAX_RETURN_BPS / 10_000} of the stake, exact over all 10000 rolls for every h from x1.00 to x10.00; exactly x0.9 where h divides 900000 (x1, x1.5, x2, x4, x10), lowest at ${multiplierLabel(worst.h, true)} (x${worst.back / 1e6}). Timing changes the risk, not the payback; the difference stays in the Moon Fund`);
  console.log(`Launch every baby and jump at a round exit: trade-in ${rf(ev)} per ${item} (spendable) + net ${rf(combined - ev)} (side ledger) = ${rf(combined)} per ${item} (${Number(combined * 100_000n / definition.price) / 1000}% of the ${rf(definition.price)} price, exact over all 10^8 egg and crash roll pairs)`);
  console.log(`Moon Fund at session start: top payout ${rf(top)} (${rf(max)} x10, the Moon) x ${multiplier} (GameHost preview-stake multiplier) = ${rf(MOON_FUND_START)}`);
  console.log(`Backing rule: a baby worth v flies only while fund >= its Moon payout (10 v), whatever exit the player picks. The stake joins the fund, so fund' = fund + v - payout >= v > 0 and fund = ${rf(MOON_FUND_START)} - net at all times.`);
  console.log(`  Largest drain per launch: ${rf(drain)} (${definition.outcomes.find(outcome => outcome.reward === max).name} on the Moon); the first ${safe} launches of a session can never be blocked.`);
  console.log(`  Fastest pause: ${fastestLaunches} Moon landings of ${rf(max)} babies in a row leave ${rf(fastest.fund)}; only ${stillFly.join(", ") || "nothing"} can still fly.`);

  // Monte Carlo of the real flow: SDK preview ledger for eggs and trade-ins, slingshot ledger for the flights, one
  // run per exit strategy. Crash rolls come from their own seeded stream, so the egg rolls match "sell every baby" above.
  const strategies = [...LADDER_EXITS.filter(h => h < MOON_HUNDREDTHS).map(h => [`Jump at ${multiplierLabel(h)}`, h]), ["Ride to the Moon", null]];
  const sellEvery = hatchesByStrategy.get("sell every baby");
  const summary = [];
  for (const [name, exit] of strategies) {
    const eggDraw = random(seed), launchDraw = random(seed + 1), runs = [];
    for (let index = 0; index < sessions; index++) {
      const { client } = createGamePreview(definition, { friendId: 7730n, stake, rfBalance: balance, draw: eggDraw });
      let ledger = initialLedger(), hatches = 0, wins = 0, moons = 0, blocked = false, low = ledger.fund;
      for (;;) {
        const snapshot = await client.read();
        if (snapshot.rfBalance < definition.price || !(await client.canBuy(1n))) break;
        await client.buy(1n);
        const [entry] = await client.play(1n);
        const { outcomeId } = await client.settle(entry.id);
        hatches++;
        const value = definition.outcomes[outcomeId - 1].reward, blocker = launchBlocker(ledger, value);
        // Trade-in first: the value returns to the spendable balance. A refused launch still sells the baby.
        await client.redeem(outcomeId, 1n);
        if (blocker) { blocked ||= blocker === "backing"; continue; }
        const next = resolveLaunch(ledger, `baby:${entry.id}`, value, launchDraw(), exit);
        if (next.result.payout > 0n) wins++;
        if (next.result.end === "moon") moons++;
        ledger = next.ledger;
        if (ledger.fund < low) low = ledger.fund;
      }
      assert.equal(ledger.fund, MOON_FUND_START - slingshotNet(ledger), "fund = start - net");
      runs.push({ hatches, launches: ledger.launches, wins, moons, staked: ledger.staked, net: slingshotNet(ledger), fund: ledger.fund, low, blocked });
    }
    assert.deepEqual(runs.map(run => run.hatches).sort((a, b) => a - b), sellEvery, "same egg rolls as the sell every baby strategy");
    summary.push({ name, runs });
  }
  const share = (runs, test) => `${(runs.filter(test).length / runs.length * 100).toFixed(1)}%`;
  const meanOf = values => typeof values[0] === "bigint"
    ? about(values.reduce((sum, value) => sum + value, 0n) / BigInt(values.length))
    : (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1);
  const quantile = (values, q) => [...values].sort(order)[Math.floor(values.length * q)];
  const netFactor = BigInt(MAX_RETURN_BPS) - bps;
  console.log(`\nMonte Carlo: ${sessions} sessions per exit strategy (seed ${seed}; crash rolls seed ${seed + 1}) on createGamePreview, each from ${rf(balance)}: breed while the runtime sells an ${item}, trade every baby in (redeem) and launch it\n`);
  console.log("| Strategy | Launches (mean) | Paid launches | Moon landings (mean) | P(at least one Moon) | Staked (mean) | Net (mean) | Net p5 | Net median | Net p95 | P(net > 0) | Fund lowest | Blocked |");
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const { name, runs } of summary) {
    const launches = runs.reduce((sum, run) => sum + run.launches, 0), wins = runs.reduce((sum, run) => sum + run.wins, 0);
    const nets = runs.map(run => run.net), lows = runs.map(run => run.low);
    console.log(`| ${name} | ${meanOf(runs.map(run => run.launches))} | ${(wins / launches * 100).toFixed(1)}% | ${meanOf(runs.map(run => run.moons))} | ${share(runs, run => run.moons > 0)} | ` +
      `${meanOf(runs.map(run => run.staked))} | ${meanOf(nets)} | ${rf(quantile(nets, 0.05))} | ${rf(quantile(nets, 0.5))} | ${rf(quantile(nets, 0.95))} | ${share(runs, run => run.net > 0n)} | ` +
      `${rf(quantile(lows, 0))} | ${runs.filter(run => run.blocked).length} of ${runs.length} |`);
  }
  const first = summary[0].runs, meanStaked = first.reduce((sum, run) => sum + run.staked, 0n) / BigInt(first.length);
  console.log(`\nHatches and launches reproduce the "sell every baby" row above exactly (same egg rolls; the net never reaches the spendable balance), so every strategy stakes the same.`);
  console.log(`Exact identity at the round exits: E[net] = ${Number(netFactor) / 10_000} x E[staked] (every jump returns x0.9 of its stake on average, whatever ends the session). ` +
    `Here: ${Number(netFactor) / 10_000} x mean staked = ${about(meanStaked * netFactor / bps)}.`);
}
