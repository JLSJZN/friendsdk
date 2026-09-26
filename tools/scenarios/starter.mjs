// Scenario for the SDK starter UI (examples/starter, which games/rare-breeds was scaffolded from).
// Exercises the step runner, forced tiers and every in-frame runtime confirmation (buy, play,
// redeem, cancel) with the game's own game.json terms:
//   node tools/test-game.mjs examples/starter --scenario tools/scenarios/starter.mjs
import { project } from "../../dist/friend-world.js";
import { formatGameAmount } from "../../dist/experience-ui.js";
import { runSteps } from "../lib/runtime.mjs";

const rf = value => `${formatGameAmount(value, 18)} RF`;

/** Walk the starter's GameWorld to a world point (same mapping as scripts/check-starter-browser.mjs). */
const walk = point => async ({ game, viewport }) => {
  const canvas = game.locator("canvas"), box = await canvas.boundingBox(), [x, y] = project(...point);
  const position = { x: (x - 320) / 960 * box.width, y: (y - 330) / 640 * box.height };
  if (viewport.touch) await canvas.tap({ position }); else await canvas.click({ position });
};

function steps(definition, { friend = "Friend #7730", screenshots = true } = {}) {
  const item = definition.consumable.toLowerCase(), top = definition.outcomes.length, prize = definition.outcomes[top - 1];
  const buy = { title: `Buy ${item}`, description: `1 ${item} for ${friend}.`, amount: rf(definition.price) };
  return [
    { waitFor: { css: "canvas[data-x]" }, note: `starter world rendered the fixture ${friend}` },
    { tiers: [top], note: `next settle lands on ${prize.name}` },
    { click: { role: "button", name: /^Pack dispenser/ } },
    { click: { role: "button", name: `Buy one pack · ${rf(definition.price)}` } },
    { cancel: "buy", expect: buy },
    { expect: "Game action cancelled.", note: "a cancelled confirmation rejects the SDK call with this public error" },
    { click: { role: "button", name: `Buy one pack · ${rf(definition.price)}` } },
    { waitFor: { in: "page", role: "dialog", name: buy.title }, note: "confirmations render in the trusted page, not in the iframe" },
    ...(screenshots ? [{ screenshot: "runtime-confirm-buy" }] : []),
    { confirm: "buy", expect: buy },
    { expect: "One simulated pack added to your Friend." },
    { click: { role: "button", name: "Close Pack dispenser" } },
    { run: walk([356, 250]), note: "walk to the opening crate" },
    { click: { role: "button", name: /^Open a pack/ } },
    { click: { role: "button", name: "Open one pack" } },
    { confirm: "play", expect: { title: `Use ${item}`, description: `Use 1 ${item} from ${friend}.`, amount: null } },
    { expect: { role: "heading", name: prize.name }, note: "settle needs no confirmation in preview mode" },
    { expect: `${rf(prize.reward)} · ${prize.chanceBps / 100}% chance` },
    ...(screenshots ? [{ screenshot: "starter-top-prize" }] : []),
    { click: { role: "button", name: "Keep collectible" } },
    { click: { role: "button", name: "Inventory · 1" } },
    { click: { role: "button", name: "Redeem one", within: ".starter-item", nth: top - 1 } },
    { confirm: "redeem", expect: { title: "Redeem reward", description: `1 ${prize.name}; simulated RF returns to this Friend.`, amount: rf(prize.reward) } },
    { expect: `0 owned · ${rf(prize.reward)}` },
    { click: { role: "button", name: "Close Inventory" } },
    { expect: { css: ".starter-hud" }, contains: rf(20n * 10n ** 18n - definition.price + prize.reward), note: "20 RF - price + top prize" },
  ];
}

export async function test(ctx) {
  await runSteps(ctx, steps(ctx.definition), { label: `[${ctx.viewport.name}] ` });
}

export async function video(ctx) {
  await runSteps(ctx, [
    { waitFor: { css: "canvas[data-x]" } }, { wait: 400 }, { focus: { css: "canvas" } },
    { key: "ArrowRight", hold: 500 }, { key: "ArrowLeft", hold: 500 }, { wait: 300 },
    ...steps(ctx.definition, { screenshots: false }).slice(1).flatMap(step => [step, { wait: 450 }]),
    { wait: 1200 },
  ], { label: "[video] " });
}
