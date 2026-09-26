#!/usr/bin/env node
// Print the exact economy terms of a CLI game plus a Monte Carlo run of the SDK's own preview ledger.
//   node tools/economy-report.mjs [game-directory] [--sessions 5000] [--seed 7730]
// Uses parseChanceGame / expectedReward / maximumPrize / createGamePreview from dist/game.js and reads
// the preview stake and balance from the shipped runtime (dist/game-host.js), so nothing is assumed.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
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
for (const [name, keep] of strategies) {
  const draw = random(seed), results = [];
  let pauses = 0;
  for (let index = 0; index < sessions; index++) { const result = await play(draw, keep); results.push(result.hatches); if (result.paused) pauses++; }
  results.sort((a, b) => a - b);
  const mean = results.reduce((sum, value) => sum + value, 0) / results.length;
  console.log(`| ${name} | ${results[0]} | ${results[Math.floor(results.length * 0.05)]} | ${results[Math.floor(results.length / 2)]} | ${mean.toFixed(1)} | ${results.at(-1)} | ${pauses} |`);
}
const chance = id => definition.outcomes[id - 1].chanceBps / 10_000;
const atLeastOne = (p, n) => 1 - (1 - p) ** n;
console.log(`\nIn 20 hatches: P(at least one ${definition.outcomes.at(-1).name}) = ${(atLeastOne(chance(definition.outcomes.length), 20) * 100).toFixed(1)}%, ` +
  `P(at least one of the top two tiers) = ${(atLeastOne(chance(definition.outcomes.length) + chance(definition.outcomes.length - 1), 20) * 100).toFixed(1)}%`);
