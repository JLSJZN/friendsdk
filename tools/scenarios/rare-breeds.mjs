// Scenario for games/rare-breeds, picked up by default by
//   node tools/test-game.mjs      (export test: both viewports, reduced motion on)
//   node tools/record-video.mjs   (export video: 960 x 640, reduced motion off)
// Until index.tsx mounts the Rare Breeds UI (no "Find a match" button yet) both fall back to a smoke run.
// Labels follow src/ui/* at the time of writing; adjust them here if the UI copy changes.
// Step reference: tools/lib/runtime.mjs runSteps. Confirmation titles come from game.json: "Buy egg",
// "Use egg", "Redeem reward" (settle needs no confirmation in preview mode).
import { runSteps } from "../lib/runtime.mjs";

const FIND = { role: "button", name: /^Find a match/ };
const BREED = { role: "button", name: /^(Buy egg & breed|Breed ·)/ };
const REVEAL = { role: "dialog", name: "Your new baby" };

const smoke = [{ waitFor: { css: "canvas" }, note: "world canvas mounted" }];

/** One hatch: Matchmaker -> Breed (buy + use egg confirmations) -> hatch reveal. */
const hatch = ({ buys = true, timeout = 20_000 } = {}) => [
  { click: FIND },
  { click: BREED },
  ...(buys ? [{ confirm: "buy", expect: { title: "Buy egg", description: "1 egg for Friend #7730.", amount: "1 RF" } }] : []),
  { confirm: "play", expect: { title: "Use egg", description: "Use 1 egg from Friend #7730.", amount: null } },
  { waitFor: REVEAL, timeout, note: "hatch sequence finished" },
];

export const testSteps = [
  { tiers: ["spotted", "prismatic"], note: "first hatch Spotted, second Prismatic" },
  ...hatch(),
  { expect: { css: ".rb-card" }, contains: "Spotted" },
  { screenshot: "reveal-spotted" },
  { click: { role: "button", name: "Keep" } },
  ...hatch(),
  { expect: { css: ".rb-card" }, contains: "Prismatic" },
  { click: { role: "button", name: /Sanctuary.*\+/ } },
  { confirm: "redeem", expect: { title: "Redeem reward", description: "1 Prismatic hatchling; simulated RF returns to this Friend.", amount: "6 RF" } },
  { expect: { role: "group", name: "Your nursery" }, contains: "24", note: "20 - 1 - 1 + 6 simulated RF" },
];

export const videoSteps = [
  { tiers: ["mutant", "prismatic"] },
  { wait: 800 }, { focus: { css: "canvas" } },
  { key: "ArrowRight", hold: 700 }, { key: "ArrowLeft", hold: 500 },
  { wait: 400 }, ...hatch(), { wait: 2200 }, { click: { role: "button", name: "Keep" } },
  { wait: 600 }, { focus: { css: "canvas" } }, { key: "ArrowRight", hold: 900 }, { key: "ArrowDown", hold: 500 }, { key: "ArrowLeft", hold: 900 },
  { wait: 400 }, ...hatch(), { wait: 2500 }, { click: { role: "button", name: "Keep" } },
  { wait: 600 }, { focus: { css: "canvas" } }, { key: "ArrowUp", hold: 600 }, { key: "ArrowRight", hold: 1200 },
  { wait: 1200 },
];

async function uiMounted({ game }) {
  return await game.getByRole(FIND.role, { name: FIND.name }).count() > 0;
}

export async function test(ctx) {
  const label = `[${ctx.viewport.name}] `;
  await runSteps(ctx, smoke, { label });
  if (!await uiMounted(ctx)) { console.log(`  ${label}Rare Breeds UI not mounted yet ("Find a match" missing): smoke only`); return; }
  await runSteps(ctx, testSteps, { label });
}

export async function video(ctx) {
  await runSteps(ctx, smoke, { label: "[video] " });
  if (!await uiMounted(ctx)) {
    console.log('  [video] Rare Breeds UI not mounted yet: recording a short walk');
    await runSteps(ctx, [{ wait: 600 }, { focus: { css: "canvas" } }, { key: "ArrowRight", hold: 700 }, { key: "ArrowDown", hold: 400 },
      { key: "ArrowLeft", hold: 800 }, { wait: 800 }], { label: "[video] " });
    return;
  }
  await runSteps(ctx, videoSteps, { label: "[video] " });
}
