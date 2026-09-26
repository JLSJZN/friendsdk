#!/usr/bin/env node
// Automated browser check: the SDK's testGame (mock wallet, mock Robinhood RPC, recorded #7730 art,
// real runtime + ownership gate + sandbox) at a desktop and a phone viewport, one screenshot each.
//
//   node tools/test-game.mjs [game-directory] [--scenario file.mjs] [--viewport desktop|phone]
//                            [--media directory] [--timeout ms] [--no-scenario]
//
// Scenario: named export `test` (array of steps or async ctx => {}) from tools/scenarios/<game>.mjs
// by default. ctx = { page, game, friendId, account, friendWallet, viewport, definition, helpers }.
import { parseArgs } from "node:util";
import { join, resolve } from "node:path";
import { testGame } from "@rarefriends/friendsdk/testing";
import {
  DEFAULT_GAME, VIEWPORTS, createHelpers, defaultScenarioPath, loadScenario, readDefinition, relativeToRoot, runScenarioPart,
} from "./lib/runtime.mjs";

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  scenario: { type: "string" }, "no-scenario": { type: "boolean" }, viewport: { type: "string", multiple: true },
  media: { type: "string" }, timeout: { type: "string" }, help: { type: "boolean" },
} });
if (values.help) {
  console.log("Usage: node tools/test-game.mjs [game-directory] [--scenario file.mjs | --no-scenario] [--viewport desktop|phone] [--media dir] [--timeout ms]");
  process.exit(0);
}
const gameDirectory = resolve(positionals[0] ?? DEFAULT_GAME);
const media = resolve(values.media ?? join(gameDirectory, "docs/media"));
const timeout = Number(values.timeout ?? 15_000);
const definition = await readDefinition(gameDirectory);
const scenarioPath = values["no-scenario"] ? undefined : values.scenario ?? await defaultScenarioPath(gameDirectory);
const scenario = await loadScenario(scenarioPath);
const viewports = (values.viewport ?? ["desktop", "phone"]).map(name => {
  if (!VIEWPORTS[name]) throw new Error(`Unknown viewport ${name}. Use desktop or phone.`);
  return VIEWPORTS[name];
});

console.log(`Game ${relativeToRoot(gameDirectory)} (${definition.name}); scenario ${scenarioPath ? relativeToRoot(scenarioPath) : "none (smoke only)"}`);
let failed = 0;
for (const viewport of viewports) {
  const screenshot = join(media, `test-${viewport.name}-${viewport.width}x${viewport.height}.png`);
  const started = Date.now();
  let confirmations = [];
  try {
    // testGame turns on touch below 500 px wide, so the phone run taps like a phone.
    await testGame(gameDirectory, { width: viewport.width, height: viewport.height, screenshot, timeout, async check(context) {
      const helpers = createHelpers({ ...context, definition, viewport, mediaDirectory: media, prefix: "test-" });
      confirmations = helpers.confirmations;
      await runScenarioPart(scenario.test, { ...context, viewport, definition, helpers, timeout }, { label: `[${viewport.name}] ` });
    } });
    console.log(`PASS ${viewport.name} ${viewport.width}x${viewport.height}${viewport.touch ? " touch" : ""} in ${((Date.now() - started) / 1000).toFixed(1)}s; screenshot ${relativeToRoot(screenshot)}`);
    for (const item of confirmations) console.log(`  runtime confirmation ${item.action}: "${item.title}" / "${item.description}"${item.amount ? ` / ${item.amount}` : ""}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${viewport.name} ${viewport.width}x${viewport.height}: ${error.message}`);
  }
}
process.exitCode = failed ? 1 : 0;
