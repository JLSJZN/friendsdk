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
// The intro tour opens on every game start (the sandbox has no storage): Next x3, then Start breeding, or Skip intro.
const SKIP_INTRO = { role: "button", name: "Skip intro" };
const NEXT = { role: "button", name: "Next" };
const START = { role: "button", name: "Start breeding" };
// Hearts: game points kept babies earn (KEEP_BONUS 5 on Keep, then income every 10 s); the HUD counter opens the shop.
const KEEP = { role: "button", name: /^Keep/ };
const HEARTS = { role: "button", name: /Hearts, open the shop/ };
const BUY_HAT = { role: "button", name: /^Buy Party hat/ };
const PUT_ON = { role: "button", name: /^Put on your Friend/ };
/** Wait until the HUD Hearts counter shows at least `min`. */
const heartsAtLeast = (min, note) => ({ note, run: async ({ game }) => {
  const counter = game.locator(".rb-hud-hearts .rb-hud-num");
  const end = Date.now() + 15_000;
  let value = -1;
  while (Date.now() < end) {
    value = Number(await counter.textContent());
    if (value >= min) return;
    await new Promise(done => setTimeout(done, 200));
  }
  throw new Error(`Hearts counter shows ${value}, expected at least ${min}`);
} });
const INTRO_TITLES = ["Your Friend's pixels are its DNA", "Find a match, hatch an egg", "What can hatch", "Keep or Sanctuary"];

// nth 0: the intro tour draws its own sprite canvases after the world canvas.
const smoke = [{ waitFor: { css: "canvas", nth: 0 }, note: "world canvas mounted" }];

/** One hatch: Matchmaker -> Breed (buy + use egg confirmations) -> hatch reveal. */
const hatch = ({ buys = true, timeout = 20_000 } = {}) => [
  { click: FIND },
  { click: BREED },
  ...(buys ? [{ confirm: "buy", expect: { title: "Buy egg", description: "1 egg for Friend #7730.", amount: "1 RF" } }] : []),
  { confirm: "play", expect: { title: "Use egg", description: "Use 1 egg from Friend #7730.", amount: null } },
  { waitFor: REVEAL, timeout, note: "hatch sequence finished" },
];

/** Click through all four intro steps (each title must show), then start playing. */
const introTour = (pause = 0) => INTRO_TITLES.flatMap((title, index) => [
  { waitFor: { role: "dialog", name: title }, note: `intro step ${index + 1}` },
  ...(pause ? [{ wait: pause }] : []),
  { click: index === INTRO_TITLES.length - 1 ? START : NEXT },
]);

export const testSteps = [
  { waitFor: SKIP_INTRO, note: "intro tour opens on start" },
  { screenshot: "intro" },
  ...introTour(),
  { waitFor: { role: "dialog" }, state: "detached", note: "intro closed" },
  { tiers: ["spotted", "prismatic"], note: "first hatch Spotted, second Prismatic" },
  heartsAtLeast(0, "Hearts start at 0"),
  ...hatch(),
  { expect: { css: ".rb-card" }, contains: "Spotted" },
  { screenshot: "reveal-spotted" },
  { click: KEEP },
  heartsAtLeast(5, "Keep bonus: +5 Hearts"),
  ...hatch(),
  { expect: { css: ".rb-card" }, contains: "Prismatic" },
  { click: KEEP },
  heartsAtLeast(10, "second Keep bonus"),
  { click: HEARTS, note: "Hearts counter opens the shop" },
  { waitFor: { role: "dialog", name: "Hearts shop" } },
  { screenshot: "shop" },
  { click: BUY_HAT, timeout: 45_000, note: "waits for the brood's income to reach 20 Hearts" },
  { click: PUT_ON },
  { waitFor: { role: "button", name: /^Take off/ }, note: "the Friend wears the Party hat" },
  { screenshot: "shop-hat" },
  { click: { role: "button", name: "Close Hearts shop" } },
  { click: { role: "button", name: /^Brood,/ } },
  { click: { role: "button", name: /Prismatic.*Show details/ } },
  { click: { role: "button", name: /Sanctuary.*\+/ } },
  { confirm: "redeem", expect: { title: "Redeem reward", description: "1 Prismatic hatchling; simulated RF returns to this Friend.", amount: "6 RF" } },
  { expect: { role: "group", name: "Your nursery" }, contains: "24", note: "20 - 1 - 1 + 6 simulated RF" },
];

export const videoSteps = [
  { tiers: ["mutant", "prismatic"] },
  { wait: 600 }, ...introTour(2400), { wait: 900 }, { focus: { css: "canvas", nth: 0 } },
  { key: "ArrowRight", hold: 700 }, { key: "ArrowLeft", hold: 500 },
  { wait: 400 }, ...hatch(), { wait: 2200 }, { click: KEEP },
  { wait: 600 }, { focus: { css: "canvas", nth: 0 } }, { key: "ArrowRight", hold: 900 }, { key: "ArrowDown", hold: 500 }, { key: "ArrowLeft", hold: 900 },
  { wait: 400 }, ...hatch(), { wait: 2500 }, { click: KEEP },
  { wait: 1500 }, { click: HEARTS }, { wait: 1200 }, { click: BUY_HAT, timeout: 45_000 }, { wait: 700 }, { click: PUT_ON }, { wait: 1800 },
  { click: { role: "button", name: "Close Hearts shop" } },
  { wait: 600 }, { focus: { css: "canvas", nth: 0 } }, { key: "ArrowUp", hold: 600 }, { key: "ArrowRight", hold: 1200 },
  { wait: 1200 },
];

async function uiMounted({ game }) {
  return await game.getByRole(FIND.role, { name: FIND.name }).count() > 0
    || await game.getByRole(SKIP_INTRO.role, { name: SKIP_INTRO.name }).count() > 0;
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
    await runSteps(ctx, [{ wait: 600 }, { focus: { css: "canvas", nth: 0 } }, { key: "ArrowRight", hold: 700 }, { key: "ArrowDown", hold: 400 },
      { key: "ArrowLeft", hold: 800 }, { wait: 800 }], { label: "[video] " });
    return;
  }
  await runSteps(ctx, videoSteps, { label: "[video] " });
}
