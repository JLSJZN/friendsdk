#!/usr/bin/env node
// Print the exact economy terms of a CLI game plus a Monte Carlo run of the SDK's own preview ledger.
//   node tools/economy-report.mjs [game-directory] [--sessions 5000] [--seed 7730]
// Uses parseChanceGame / expectedReward / maximumPrize / createGamePreview from dist/game.js and reads
// the preview stake and balance from the shipped runtime (dist/game-host.js), so nothing is assumed.
// Games with src/slingshot.ts (Rare Breeds) also get the Moon Slingshot section: exact zone and payout
// tables, the Moon Fund backing rule, exact session odds and a Monte Carlo of launching every baby.
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
  LAUNCH_ZONES, MOON_FUND_START, expectedMultiplierBps, initialLedger, launchBlocker, launchExpectedValue, launchPayout,
  maxLaunchPayout, multiplierLabel, resolveLaunch, slingshotNet, zoneForRoll,
}) {
  const bps = 10_000n, top = LAUNCH_ZONES.at(-1), item = definition.consumable.toLowerCase();
  const order = (a, b) => a < b ? -1 : a > b ? 1 : 0, about = value => `${(Number(value) / Number(RF)).toFixed(3)} RF`;
  console.log(`\n## Moon Slingshot (${relativeToRoot(slingshotPath)}, simulated side ledger)\n`);
  console.log("A launch first trades the baby in through the SDK (client.redeem: tier token burned, its fixed value lands in the spendable RF balance); that value is the stake. " +
    "One roll in 0-9999 then picks the landing zone (cumulative weights, like outcomeForRoll), which multiplies the stake. " +
    "The side ledger books only payout - stake (the net); it is not spendable.\n");
  console.log("| Zone | Landing | Rolls | Weight (bps) | Chance | Multiplier | EV share |");
  console.log("| --- | --- | --- | ---: | ---: | ---: | ---: |");
  let first = 0, weights = 0;
  for (const zone of LAUNCH_ZONES) {
    const last = first + zone.chanceBps - 1;
    assert.equal(zoneForRoll(first), zone.id);
    assert.equal(zoneForRoll(last), zone.id);
    console.log(`| ${zone.id} | ${zone.label} | ${first}-${last} | ${zone.chanceBps} | ${zone.chanceBps / 100}% | ${multiplierLabel(zone.multiplierBps)} | ${multiplierLabel(zone.chanceBps * zone.multiplierBps / 10_000)} |`);
    first = last + 1;
    weights += zone.chanceBps;
  }
  let multiplierSum = 0;
  for (let roll = 0; roll < 10_000; roll++) multiplierSum += LAUNCH_ZONES.find(zone => zone.id === zoneForRoll(roll)).multiplierBps;
  assert.equal(multiplierSum, expectedMultiplierBps() * 10_000, "expected multiplier is exact over all 10000 rolls");
  console.log(`| | **Total** | 0-9999 | ${weights} | 100% | | **${multiplierLabel(expectedMultiplierBps())}** |\n`);

  console.log(`| Outcome | Stake (value) | ${LAUNCH_ZONES.map(zone => `${zone.id} ${multiplierLabel(zone.multiplierBps)}`).join(" | ")} | Payout EV | Net EV |`);
  console.log(`| --- | ---: | ${LAUNCH_ZONES.map(() => "---:").join(" | ")} | ---: | ---: |`);
  for (const outcome of definition.outcomes) {
    const payoutEV = launchExpectedValue(outcome.reward);
    console.log(`| ${outcome.name} | ${rf(outcome.reward)} | ${LAUNCH_ZONES.map(zone => rf(launchPayout(outcome.reward, zone.id))).join(" | ")} | ${rf(payoutEV)} | ${rf(payoutEV - outcome.reward)} |`);
  }
  const combined = definition.outcomes.reduce((sum, outcome) => sum + launchExpectedValue(outcome.reward) * BigInt(outcome.chanceBps), 0n) / bps;
  assert.equal(combined, ev * BigInt(expectedMultiplierBps()) / bps, "launch EV composes with the egg EV");
  const fundStart = maxLaunchPayout(max) * multiplier;
  assert.equal(MOON_FUND_START, fundStart, "Moon Fund follows the preview-stake convention");
  const drain = definition.outcomes.reduce((worst, outcome) => LAUNCH_ZONES.reduce((most, zone) => {
    const loss = launchPayout(outcome.reward, zone.id) - outcome.reward;
    return loss > most ? loss : most;
  }, worst), 0n);
  const safe = (MOON_FUND_START - maxLaunchPayout(max)) / drain + 1n;
  let fastest = initialLedger(), fastestLaunches = 0;
  while (!launchBlocker(fastest, max)) { fastest = resolveLaunch(fastest, "worst", max, 9999).ledger; fastestLaunches++; }
  const stillFly = definition.outcomes.filter(outcome => !launchBlocker(fastest, outcome.reward)).map(outcome => outcome.name);

  console.log(`\nExpected multiplier: sum(chance x multiplier) / 10000 = ${expectedMultiplierBps()} bps = ${multiplierLabel(expectedMultiplierBps())} of the stake (exact over all 10000 rolls), so the expected net per launch is ${(expectedMultiplierBps() - 10_000) / 10_000} x stake; the difference stays in the Moon Fund`);
  console.log(`Launch every baby: trade-in ${rf(ev)} per ${item} (spendable) + net ${rf(combined - ev)} (side ledger) = ${rf(combined)} per ${item} (${Number(combined * 100_000n / definition.price) / 1000}% of the ${rf(definition.price)} price, exact over all 10^8 egg and launch roll pairs)`);
  console.log(`Moon Fund at session start: top ${top.id} payout ${rf(maxLaunchPayout(max))} (${rf(max)} ${multiplierLabel(top.multiplierBps)}) x ${multiplier} (GameHost preview-stake multiplier) = ${rf(MOON_FUND_START)}`);
  console.log(`Backing rule: a baby worth v flies only while fund >= its ${top.id} payout (${multiplierLabel(top.multiplierBps)} v). The stake joins the fund, so fund' = fund + v - payout >= v > 0 and fund = ${rf(MOON_FUND_START)} - net at all times.`);
  console.log(`  Largest drain per launch: ${rf(drain)} (${definition.outcomes.find(outcome => outcome.reward === max).name} on the ${top.id}); the first ${safe} launches of a session can never be blocked.`);
  console.log(`  Fastest pause: ${fastestLaunches} ${top.id} landings of ${rf(max)} babies in a row leave ${rf(fastest.fund)}; only ${stillFly.join(", ") || "nothing"} can still fly.`);

  // Monte Carlo of the real flow: SDK preview ledger for eggs and trade-ins, slingshot ledger for the launches.
  // Launch rolls come from their own seeded stream, so the egg rolls match the "sell every baby" strategy above.
  const eggDraw = random(seed), launchDraw = random(seed + 1), runs = [];
  for (let index = 0; index < sessions; index++) {
    const { client } = createGamePreview(definition, { friendId: 7730n, stake, rfBalance: balance, draw: eggDraw });
    let ledger = initialLedger(), hatches = 0, moons = 0, blocked = false, low = ledger.fund;
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
      const next = resolveLaunch(ledger, `baby:${entry.id}`, value, launchDraw());
      if (next.result.zone === top.id) moons++;
      ledger = next.ledger;
      if (ledger.fund < low) low = ledger.fund;
    }
    assert.equal(ledger.fund, MOON_FUND_START - slingshotNet(ledger), "fund = start - net");
    runs.push({ hatches, launches: ledger.launches, moons, staked: ledger.staked, net: slingshotNet(ledger), fund: ledger.fund, low, blocked });
  }
  const sellEvery = hatchesByStrategy.get("sell every baby");
  assert.deepEqual(runs.map(run => run.hatches).sort((a, b) => a - b), sellEvery, "same egg rolls as the sell every baby strategy");
  const share = test => `${(runs.filter(test).length / runs.length * 100).toFixed(1)}%`;
  const meanOf = values => typeof values[0] === "bigint"
    ? about(values.reduce((sum, value) => sum + value, 0n) / BigInt(values.length))
    : (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1);
  const row = (label, key, format) => {
    const values = runs.map(run => run[key]), sorted = [...values].sort(order), at = q => format(sorted[Math.floor(sorted.length * q)]);
    console.log(`| ${label} | ${format(sorted[0])} | ${at(0.05)} | ${at(0.5)} | ${meanOf(values)} | ${at(0.95)} | ${format(sorted.at(-1))} |`);
  };
  const count = value => String(value);
  const meanStaked = runs.reduce((sum, run) => sum + run.staked, 0n) / BigInt(runs.length);
  const meanNet = runs.reduce((sum, run) => sum + run.net, 0n) / BigInt(runs.length);
  const netFactor = BigInt(expectedMultiplierBps()) - bps;

  console.log(`\nMonte Carlo: ${sessions} sessions (seed ${seed}; launch rolls seed ${seed + 1}) on createGamePreview, each from ${rf(balance)}: breed while the runtime sells an ${item}, trade every baby in (redeem) and launch it\n`);
  console.log("| Per session | Min | p5 | Median | Mean | p95 | Max |");
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  row("Hatches", "hatches", count);
  row("Launches", "launches", count);
  row(`${top.id[0].toUpperCase()}${top.id.slice(1)} landings`, "moons", count);
  row("Staked (traded-in value)", "staked", rf);
  row("Slingshot net (payout - stake)", "net", rf);
  row("Moon Fund at the end", "fund", rf);
  row("Moon Fund, lowest point", "low", rf);
  console.log(`\nHatches reproduce the "sell every baby" row above exactly (same egg rolls; the net never reaches the spendable balance).`);
  console.log(`P(at least one ${top.id[0].toUpperCase()}${top.id.slice(1)} landing) = ${share(run => run.moons > 0)}, P(net > 0) = ${share(run => run.net > 0n)}, ` +
    `P(Moon Fund ever blocks a launch) = ${runs.filter(run => run.blocked).length} of ${runs.length}`);
  console.log(`Exact identity: E[net] = ${Number(netFactor) / 10_000} x E[staked] (every launch returns ${multiplierLabel(expectedMultiplierBps())} of its stake on average, whatever ends the session). ` +
    `Here: ${Number(netFactor) / 10_000} x mean staked = ${about(meanStaked * netFactor / bps)}, simulated mean net = ${about(meanNet)}.`);
}
