// Trailer for games/rare-breeds: one take with every highlight, then a tight cut of it.
//
//   node tools/record-video.mjs games/rare-breeds --scenario tools/scenarios/rare-breeds-trailer.mjs --name trailer --frames --no-gif
//
// writes docs/media/trailer.mp4 (the cut below, 2x nearest neighbour) and trailer-poster.png. Add --keep-webm and
// --media <dir> to keep the lossless take (trailer.mkv) and trailer-marks.json for re-cutting with tools/cut-video.mjs.
// The take: the intro's nursery map, a walk past the four stations, a Prismatic hatch (kept), a Common hatch (traded
// in at the Sanctuary), the brood and a Party hat, and a Moon Slingshot flight to the Moon. Tiers are forced in the
// runtime page ({ tiers }); the crash point is drawn inside the game frame, so { gameRolls: [0] } makes it the Moon
// (any roll up to 899 is good for x10). Confirmations happen in the take and are cut out.
import { runSteps } from "../lib/runtime.mjs";

const FIND = { role: "button", name: /^Find a match/ };
const CLOSE_MATCH = { role: "button", name: "Close Find a match" };
const STOCK_UP = { role: "button", name: /^Stock up: 5 eggs/ };
const BREED = { role: "button", name: /^(Buy egg & breed|Breed ·)/ };
const HATCHING = { role: "dialog", name: /hatched$/ };
const REVEAL = { role: "dialog", name: "Your new baby" };
const NEXT = { role: "button", name: "Next" };
const SKIP_INTRO = { role: "button", name: "Skip intro" };
const KEEP = { role: "button", name: /^Keep/ };
const TRADE_IN = { role: "button", name: /Trade in at the Sanctuary/ };
const HEARTS = { role: "button", name: /Hearts, open the shop/ };
const BUY_HAT = { role: "button", name: /^Buy Party hat/ };
const PUT_ON = { role: "button", name: /^Put on your Friend/ };
const CLOSE_SHOP = { role: "button", name: "Close Hearts shop" };
const SLING_PANEL = { role: "dialog", name: "Shoot for the Moon" };
const LAUNCH = { role: "button", name: /^Launch .+: / };
const HOLD = { role: "button", name: /^Hold to fly$/ };
const RESULT = { css: ".rb-launch-card" };
const DISMISS = { role: "button", name: "Dismiss" };
/** The Party hat's price in Hearts (src/accessories.ts). */
const HAT_PRICE = 20;

/** Walk the Friend around the brood's room until the Hearts counter reaches `min` (the kept Prismatic earns 10 per 10 s). */
const strollUntilHearts = min => ({ run: async ({ game, helpers, page }) => {
  const counter = game.locator(".rb-hud-hearts .rb-hud-num"), spots = [[300, 430], [700, 440], [480, 330], [620, 470], [360, 360]];
  const end = Date.now() + 45_000;
  for (let index = 0; Number(await counter.textContent()) < min; index++) {
    if (Date.now() > end) throw new Error(`Hearts stayed below ${min}`);
    await helpers.world(spots[index % spots.length]);
    await page.waitForTimeout(1600);
  }
} });

/** Breed with the Matchmaker's suggested mate from an egg in stock: "Use egg", the courtship, the hatch and its card. */
const hatch = suffix => [
  { click: BREED },
  { confirm: "play" },
  { mark: `play${suffix}` },
  { waitFor: HATCHING, timeout: 20_000 },
  { mark: `hatch${suffix}` },
  { waitFor: REVEAL, timeout: 20_000 },
  { mark: `reveal${suffix}` },
];

export const video = [
  { tiers: ["prismatic", "common"] },
  // The intro's nursery map: the four stations and what each does.
  { waitFor: { role: "dialog", name: "Your Friend's pixels are its DNA" } },
  { click: NEXT },
  { waitFor: { role: "dialog", name: "Your nursery" } },
  { mark: "intro-nursery" },
  { wait: 2600 },
  { click: SKIP_INTRO },
  // Off camera: five eggs in one confirmation (the incubator shows them), which also retires the "Start here" coach.
  { click: FIND },
  { click: STOCK_UP },
  { confirm: "buy" },
  { click: CLOSE_MATCH },
  { waitFor: { role: "dialog" }, state: "detached" },
  { click: DISMISS, note: "the eggs toast" },
  { wait: 500 },
  // The Friend walks past the stations; each shows its name tag when the Friend is near.
  { mark: "walk" },
  { world: [205, 300] }, { wait: 1500 },
  { world: [480, 240] }, { wait: 1500 },
  { world: [596, 290] }, { wait: 1000 },
  { world: [762, 206] }, { wait: 1300 },
  { mark: "walk-end" },
  { world: [480, 400] }, { wait: 1300 },
  // Prismatic: Matchmaker, courtship, the full hatch and the reveal card.
  { click: FIND },
  { mark: "match" },
  { wait: 1600 },
  ...hatch(""),
  { wait: 3500 },
  { click: KEEP },
  { mark: "keep" },
  { wait: 2000 },
  // Common: second hatch, then traded in at the Sanctuary (the baby walks out through the garden gate).
  { click: FIND },
  { mark: "match2" },
  { wait: 900 },
  ...hatch("2"),
  { wait: 2500 },
  { click: TRADE_IN },
  { confirm: "redeem" },
  { mark: "tradein" },
  { wait: 3500 },
  // The brood: the Prismatic follows the Friend and pops Hearts; a Party hat from the Hearts shop.
  { mark: "brood" },
  strollUntilHearts(HAT_PRICE),
  { wait: 600 },
  { click: HEARTS },
  { mark: "shop" },
  { wait: 700 },
  { click: BUY_HAT },
  { wait: 500 },
  { click: PUT_ON },
  { mark: "hat-on" },
  { wait: 900 },
  { click: CLOSE_SHOP },
  { mark: "shop-closed" },
  { wait: 600 },
  // Moon Slingshot: tap the station (the Friend walks over and opens it), trade in and fly, hold to the Moon.
  { world: [594, 160] },
  { waitFor: SLING_PANEL },
  { mark: "sling-panel" },
  { wait: 1800 },
  { click: LAUNCH },
  { confirm: "redeem" },
  { mark: "shot" },
  { waitFor: HOLD, timeout: 20_000 },
  { mark: "ready" },
  { wait: 900 },
  { gameRolls: [0], note: "roll 0: crash point x10, good for the Moon" },
  { down: HOLD },
  { mark: "ignite" },
  { wait: 9600 },
  { up: HOLD },
  { waitFor: RESULT, timeout: 20_000 },
  { mark: "result" },
  { expect: { css: ".rb-launch-line" }, matches: /good for the Moon/, note: "the rocket really reached the Moon" },
  { wait: 3200 },
  { mark: "end" },
];

/** The cut: every second a highlight. Times are seconds relative to the marks above. */
export const cut = {
  fps: 30, scale: 2, crf: 20,
  // The Prismatic burst: rainbow rays, the name and its traits.
  poster: { at: "reveal", offset: -0.4 },
  segments: [
    // The nursery: the intro's station map, then the walk past the four stations (name tags and prompts).
    { from: "intro-nursery", start: 0.3, end: 2.3 },
    { from: "walk", start: 0, to: "walk-end", end: 0.2, speed: 1.3, fade: 0.3 },
    // Prismatic: Matchmaker, the mate walks in, the full hatch, the reveal card, kept.
    { from: "match", start: 0, end: 1.4, fade: 0.25 },
    { from: "play", start: 0, to: "hatch", end: 0, speed: 1.2 },
    { from: "hatch", start: 0.25, to: "reveal", end: 2.8 },
    { from: "keep", start: 0.1, end: 1.1 },
    // Common: a faster hatch, its card, traded in at the Sanctuary (the baby walks out through the gate).
    { from: "hatch2", start: 0.5, to: "reveal2", end: 1.5, speed: 1.4, fade: 0.25 },
    { from: "tradein", start: 0, end: 2.6 },
    // The brood follows the Friend and pops Hearts; a Party hat; off to the slingshot.
    { from: "brood", start: 0, end: 3.0, fade: 0.25 },
    { from: "shop", start: 0, to: "hat-on", end: 0.6 },
    { from: "shop-closed", start: 0.3, to: "sling-panel", end: 1.3 },
    // Moon Slingshot: the shot out of the window, ready, hold: roof x1.5 and cloud x2 in real time, orbit x4 faster,
    // then the Moon at x10, touchdown and the result card.
    { from: "shot", start: 0, to: "ready", end: 0.5 },
    { from: "ignite", start: -0.2, end: 2.8 },
    { from: "ignite", start: 2.8, end: 8.4, speed: 1.6 },
    { from: "ignite", start: 8.4, to: "result", end: 2.6 },
  ],
};
