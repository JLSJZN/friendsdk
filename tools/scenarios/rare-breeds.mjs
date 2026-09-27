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
// The intro tour opens on every game start (the sandbox has no storage): Next x5, then Start breeding, or Skip intro.
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
// Same order as INTRO_TITLES in src/ui/intro.ts.
const INTRO_TITLES = ["Your Friend's pixels are its DNA", "Your nursery", "Find a match, hatch an egg", "What can hatch", "What to do with a baby", "Your screen"];
// Moon Slingshot: the launch trades the baby in first ("Redeem reward"); the flight then draws the crash point at
// ignition (simulated side ledger). The roll is browser randomness (the fixture pins it), so the steps accept a jump,
// a fizzle or a crash.
const SLING_HINT = { role: "button", name: /^Moon Slingshot: x0 to x10$/ };
const SLING_PANEL = { role: "dialog", name: "Shoot for the Moon" };
const LAUNCH = { role: "button", name: /^Launch .+: / };
const HOLD = { role: "button", name: /^Hold to fly$/ };
const LAUNCH_CARD = { css: ".rb-launch-card" };
/** Launch: a click on desktop, a real tap (touch pointer) on the phone. */
const pressLaunch = note => [{ click: LAUNCH, only: "desktop", note }, { tap: LAUNCH, only: "phone", note }];
const SPOTTED_REDEEM = { title: "Redeem reward", description: "1 Spotted hatchling; simulated RF returns to this Friend.", amount: "1 RF" };
/** Skip the ending if it is still running (reduced motion ends it in under a second), then wait for the result card. */
const skipFlight = { note: "flight ending, Skip", run: async ({ game }) => {
  const skip = game.getByRole("button", { name: "Skip" }), card = game.locator(LAUNCH_CARD.css);
  await skip.or(card).first().waitFor({ timeout: 15_000 });
  if (await skip.isVisible()) await skip.click({ timeout: 2_000 }).catch(() => {});
  await card.waitFor({ timeout: 10_000 });
} };

/** Mid-hold: still in the air and past x1.5 after 2.4 s (x1.84 on the curve), unless the rocket already gave out. */
const climbing = { note: "the live multiplier climbs while holding", run: async ({ game }) => {
  const stage = await game.locator(".rb-launch").getAttribute("data-stage");
  if (stage !== "flying") return;
  const shown = await game.locator(".rb-flight-mult").textContent();
  if (!/^x\d+\.\d\d$/.test(shown ?? "") || Number(shown.slice(1)) < 1.5) throw new Error(`Live multiplier shows ${shown} after 2.4 s of holding`);
} };

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

/** Click through all six intro steps (each title must show), then start playing. `shots`: step index -> screenshot name. */
const introTour = (pause = 0, shots = {}) => INTRO_TITLES.flatMap((title, index) => [
  { waitFor: { role: "dialog", name: title }, note: `intro step ${index + 1}` },
  ...(pause ? [{ wait: pause }] : []),
  ...(shots[index] ? [{ wait: 300 }, { screenshot: shots[index] }] : []),
  { click: index === INTRO_TITLES.length - 1 ? START : NEXT },
]);

export const testSteps = [
  { waitFor: SKIP_INTRO, note: "intro tour opens on start" },
  { screenshot: "intro" },
  // The room picture with the station markers and the HUD legend.
  ...introTour(0, { 1: "intro-nursery", 5: "intro-screen" }),
  { waitFor: { role: "dialog" }, state: "detached", note: "intro closed" },
  { tiers: ["spotted", "prismatic"], note: "first hatch Spotted, second Prismatic" },
  heartsAtLeast(0, "Hearts start at 0"),
  ...hatch(),
  { expect: { css: ".rb-card" }, contains: "Spotted" },
  { expect: { css: ".rb-lineage" }, matches: /^Hatch #1 ·\sF1$/, note: "hatch number and generation" },
  { expect: { css: ".rb-card-news" }, matches: /New breed: [A-Z][A-Za-z ]+ · 1\/45/, note: "breed book discovery" },
  { screenshot: "reveal-spotted" },
  { click: KEEP },
  heartsAtLeast(5, "Keep bonus: +5 Hearts"),
  ...hatch(),
  { expect: { css: ".rb-card" }, contains: "Prismatic" },
  { click: KEEP },
  { expect: { css: ".rb-toast" }, matches: /can pass on its .+ \(about 1 in 2( each)?\): pick it as a parent\.$/, note: "one-time tip: the kept Prismatic can pass on its shapes" },
  heartsAtLeast(10, "second Keep bonus"),
  // A kept Prismatic carries its shape mutations: picked as Parent A, the Matchmaker says what it can pass on.
  { click: FIND },
  { click: { css: ".rb-section-a .rb-pick", nth: 2 }, note: "the Prismatic baby as Parent A" },
  { expect: { css: ".rb-foot-pass" }, matches: /^Can pass on: .+ \(about 1 in 2( each)?\)$/ },
  { screenshot: "match-pass-on" },
  { click: { role: "button", name: "Close Find a match" } },
  { click: HEARTS, note: "Hearts counter opens the shop" },
  { waitFor: { role: "dialog", name: "Hearts shop" } },
  { screenshot: "shop" },
  { click: BUY_HAT, timeout: 45_000, note: "waits for the brood's income to reach 20 Hearts" },
  { click: PUT_ON },
  { waitFor: { role: "button", name: /^Take off/ }, note: "the Friend wears the Party hat" },
  { screenshot: "shop-hat" },
  { click: { role: "button", name: "Close Hearts shop" } },
  { click: { role: "button", name: /^Brood,/ } },
  { expect: { css: ".rb-collection-breeds" }, matches: /Breeds2\/45/, note: "two breeds in the book" },
  { screenshot: "brood" },
  { click: { role: "button", name: /Prismatic.*Show details/ } },
  { click: { role: "button", name: /Sanctuary.*\+/ } },
  { confirm: "redeem", expect: { title: "Redeem reward", description: "1 Prismatic hatchling; simulated RF returns to this Friend.", amount: "6 RF" } },
  { expect: { css: ".rb-hud-balance .rb-hud-num" }, matches: /^24 RF$/, note: "20 - 1 - 1 + 6 simulated RF" },
  // Moon Slingshot with the kept Spotted baby (stake 1 RF). Desktop taps the station in the world; the phone uses the first-time hint.
  { waitFor: { role: "button", name: "Brood, 1 baby" } },
  { expect: SLING_HINT, note: "first-time hint: a kept baby and the slingshot never opened" },
  { world: [594, 160], only: "desktop", note: "tap the Moon Slingshot: the Friend walks over and opens it" },
  { tap: SLING_HINT, only: "phone" },
  { waitFor: SLING_PANEL },
  { screenshot: "slingshot" },
  ...pressLaunch("launch asks for the trade-in first"),
  { cancel: "redeem", expect: SPOTTED_REDEEM },
  { expect: { css: ".rb-toast" }, contains: "Your baby stays with you", note: "cancelling the trade-in changes nothing" },
  { expect: { css: ".rb-hud-balance .rb-hud-num" }, matches: /^24 RF$/ },
  { waitFor: LAUNCH, note: "the panel stays open with the baby still in it" },
  ...pressLaunch(),
  { confirm: "redeem", expect: SPOTTED_REDEEM },
  { waitFor: HOLD, note: "flight overlay opens ready: the baby strapped to its rocket" },
  { expect: { css: ".rb-flight-mult" }, matches: /^x1\.00$/ },
  { screenshot: "slingshot-ready" },
  { down: HOLD, note: "press lights the rocket (the crash point is drawn now); hold to climb" },
  { wait: 2400 },
  climbing,
  { screenshot: "slingshot-flight" },
  { up: HOLD, note: "let go: jump (a fizzle or crash ends the flight on its own)" },
  skipFlight,
  { expect: { css: ".rb-launch-sums" }, matches: /Payout\d[\d.]* RF.*Stake1 RF.*Net[+-]?\d[\d.]* RF/, note: "result card: payout, stake, net" },
  { expect: { css: ".rb-launch-line" }, matches: /would have given out at x\d+\.\d\d|good for the Moon|gave out at x\d+\.\d\d|fizzled on the pad/, note: "result card: the revealed crash point" },
  { expect: { css: ".rb-launch-money" }, matches: /^Your 1 RF trade-in is in your balance\. .*Slingshot net/, note: "result card: where the money went" },
  { screenshot: "slingshot-result" },
  { click: { role: "button", name: /nursery/i }, note: "back to the nursery" },
  { waitFor: LAUNCH_CARD, state: "detached" },
  { waitFor: { role: "button", name: "Brood, 0 babies" }, note: "the launched baby left the brood" },
  { expect: { css: ".rb-hud-balance .rb-hud-num" }, matches: /^25 RF$/, note: "the 1 RF stake came back as the trade-in" },
  { expect: { role: "button", name: /^Slingshot net, simulated RF: [+-]?\d[\d.]* RF\. Open the Moon Slingshot$/ }, note: "HUD slingshot net pill" },
  { waitFor: SLING_HINT, state: "detached", note: "the hint is gone once the slingshot was opened" },
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
