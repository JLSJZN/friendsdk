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

// Pixel provenance: tap (or click) the middle baby row that came through Parent A (a kept F1 baby), so its path has two
// steps. The row is traced to its real Friend: "Row 9 of Zibu: your Friend #7730 (Hoverer) via Pip (F1)", with that
// Friend's portrait (in the trio's side margin on desktop, in the caption on phones).
/** Rows (0-based) whose cell in the card's link to Parent A or B has `className`, e.g. "rb-on" (came from that parent). */
const linkRows = (game, side, className) => game.locator(`.rb-card .rb-trio-link-${side} .rb-trio-cell`)
  .evaluateAll((cells, name) => cells.flatMap((cell, row) => cell.classList.contains(name) ? [row] : []), className);
/** Tap (or click) row `row` of the baby's portrait on the result card. */
const tapBabyRow = async ({ game, viewport }, row) => {
  const slot = game.locator(".rb-card .rb-trio-slot-baby");
  const { px, border } = await slot.evaluate(element => ({ px: parseFloat(getComputedStyle(element).getPropertyValue("--rb-px")), border: element.clientTop }));
  const position = { x: (await slot.boundingBox()).width / 2, y: border + (row + 1.5) * px };
  if (viewport.touch) await slot.tap({ position }); else await slot.click({ position });
};
const traceRowFromParentA = { note: "trace a row through Parent A down to its real Friend", run: async ctx => {
  const rows = await linkRows(ctx.game, "a", "rb-on");
  if (!rows.length) throw new Error("No DNA row came from Parent A");
  await tapBabyRow(ctx, rows[Math.floor(rows.length / 2)]);
} };
const TRACED = /^Row \d+ of [A-Z][a-z]+: (your )?Friend #\d+ \([A-Za-z]+\) via [A-Z][a-z]+ \(F1\)/;
// An F2 Prismatic now and then (about 1 in 50 pairs) has no shape whose rows a baby with your Friend can take: its Keep
// toast is then the plain one, and the Matchmaker names nothing to pass on (the Gene Lab steps skip the shape lock too).
const prismatic = { name: "", passes: true };
const rememberPrismatic = { note: "remember the Prismatic's name", run: async ({ game }) => {
  prismatic.name = (await game.locator(".rb-card .rb-trio-name-baby strong").textContent())?.trim() ?? "";
} };
const passOnTip = { note: "one-time tip: the kept Prismatic can pass on its shapes", run: async ({ game }) => {
  const toast = game.locator(".rb-toast"), end = Date.now() + 10_000;
  let text = "";
  while (Date.now() < end) {
    text = (await toast.textContent({ timeout: 1_000 }).catch(() => "")) ?? "";
    if (text.startsWith(`${prismatic.name} joined your brood (+5 Hearts) and can pass on its `) && / \(about 1 in 2( each)?\): pick it as a parent\.$/.test(text)) return;
    if (text === `${prismatic.name} joined your brood. +5 Hearts`) { prismatic.passes = false; console.log("    this Prismatic has no shape it can pass on"); return; }
    await new Promise(done => setTimeout(done, 200));
  }
  throw new Error(`Keep toast for ${prismatic.name} reads "${text}"`);
} };
const canPassOn = { note: "the Matchmaker names what the Prismatic can pass on", run: async ({ game }) => {
  if (prismatic.passes) await game.locator(".rb-foot-pass").filter({ hasText: /^Can pass on: .+ \(about 1 in 2( each)?\)$/ }).waitFor({ timeout: 5_000 });
} };

// Gene Lab (Matchmaker tab): lock rows of the chosen pair to one parent, paid in Hearts when the egg is used (first 3 rows
// of a session free). The steps lock one row of Parent B by tapping its portrait and, where one fits, a shape of the kept
// Prismatic by its shortcut, then check that the result card marks every locked row.
const LAB_TAB = { role: "tab", name: /^Gene Lab/ };
const PARENTS_TAB = { role: "tab", name: "Parents" };
const lab = { locks: 0, shape: false };
/** Tap (or click) a free row of Parent B's portrait, from the bottom up, that the lab allows; it must show as locked. */
const labRow = { note: "lock a row of Parent B on its portrait", run: async ({ game, viewport }) => {
  const cells = game.locator(".rb-lab-rail-b .rb-lab-cell");
  let row = 15;
  while (row > 8 && /\brb-no\b/.test(await cells.nth(row).getAttribute("class") ?? "")) row--;
  const canvas = game.locator(".rb-lab-slot-b .rb-lab-canvas"), box = await canvas.boundingBox();
  const position = { x: box.width / 2, y: (row + 1.5) * box.height / 18 };
  if (viewport.touch) await canvas.tap({ position }); else await canvas.click({ position });
  await game.locator(`.rb-lab-rail-b .rb-lab-cell:nth-child(${row + 1}).rb-on`).waitFor({ timeout: 5_000 });
} };
/** An edge shortcut (top or bottom rows from one parent, on every pair) locks its 3 rows; a second press frees them again. */
const labEdge = { note: "an edge shortcut locks 3 rows, a second press frees them", run: async ({ game, viewport }) => {
  const edges = game.locator(".rb-lab-edge"), tag = game.locator(".rb-match-tab-tag");
  let index = -1;
  for (let k = 0; k < await edges.count() && index < 0; k++) if (await edges.nth(k).isEnabled()) index = k;
  if (index < 0) throw new Error("No edge shortcut fits this pair");
  const edge = edges.nth(index), press = () => viewport.touch ? edge.tap() : edge.click();
  await press();
  await game.locator(`.rb-lab-edge[aria-pressed="true"]`).waitFor({ timeout: 5_000 });
  if (await tag.textContent() !== "3 locked") throw new Error(`After an edge shortcut the tab reads "${await tag.textContent()}"`);
  await press();
  await game.locator(`.rb-lab-edge[aria-pressed="true"]`).waitFor({ state: "detached", timeout: 5_000 });
  if (/locked/.test(await tag.textContent() ?? "")) throw new Error("A second press did not free the edge rows");
} };
/** The first shape shortcut that fits (the Prismatic's head shape or tail); the Parents tab's footer then says it will pass on. */
const labShape = { note: "lock a shape with its shortcut, where one fits", run: async ({ game, viewport }) => {
  const button = game.locator(".rb-lab-shape:not([disabled])").first();
  if (!await button.count()) { lab.shape = false; console.log("    no shape shortcut fits this pair"); return; }
  if (viewport.touch) await button.tap(); else await button.click();
  await game.locator('.rb-lab-shape[aria-pressed="true"]').first().waitFor({ timeout: 5_000 });
  lab.shape = true;
} };
const willPassOn = { note: "the footer says the locked shape will pass on", run: async ({ game }) => {
  if (lab.shape) await game.locator(".rb-foot-pass").filter({ hasText: /^Will pass on: .+ from / }).waitFor({ timeout: 5_000 });
} };
const labCount = { note: "remember how many rows are locked", run: async ({ game }) => {
  lab.locks = Number((await game.locator(".rb-match-tab-tag").textContent())?.match(/^(\d+) locked$/i)?.[1]);
  if (!(lab.locks >= 1)) throw new Error("The Gene Lab tab shows no locked rows");
} };
/** The result card: one lock mark per locked row in the DNA strip. */
const labMarks = { note: "the DNA strip marks every locked row", run: async ({ game }) => {
  const marks = await game.locator(".rb-trio-cell.rb-lock").count();
  if (marks !== lab.locks) throw new Error(`${marks} lock marks on the card, ${lab.locks} rows were locked`);
} };
/**
 * Both features at once: trace a locked row (one locked to the Prismatic F2, Parent A, where the shape lock fit). The
 * path goes through the F2 (or says "from Parent B"), and every lock mark stays on the strip, the traced one lit.
 */
const traceLockedRow = { note: "trace a locked row: path shown, lock marks kept", run: async ctx => {
  const { game } = ctx, fromA = await linkRows(game, "a", "rb-lock"), side = fromA.length ? "a" : "b";
  const row = fromA[0] ?? (await linkRows(game, "b", "rb-lock"))[0];
  if (row === undefined) throw new Error("No locked row on the card");
  await tapBabyRow(ctx, row);
  const text = await game.locator(".rb-trio-now").textContent({ timeout: 5_000 });
  const expected = side === "a" ? new RegExp(`^Row ${row + 1} of [A-Z][a-z]+: (your )?Friend #\\d+ \\([A-Za-z]+\\) via [A-Z][a-z]+ \\(F2\\)`)
    : new RegExp(`^Row ${row + 1} of [A-Z][a-z]+: (your )?Friend #\\d+ \\([A-Za-z]+\\), from Parent B`);
  if (!expected.test(text ?? "")) throw new Error(`Traced locked row ${row + 1} reads "${text}"`);
  const marks = await game.locator(".rb-trio-cell.rb-lock").count(), hot = await game.locator(`.rb-trio-link-${side} .rb-trio-cell.rb-lock.rb-hot`).count();
  if (marks !== lab.locks || hot !== 1) throw new Error(`While tracing: ${marks} lock marks (${lab.locks} locked), ${hot} lit`);
} };

// Dream child (src/dream.ts): after the first hatch your Friend dreams of a child (a thought bubble in the nursery and a
// one-time toast once the world is free). The steps tap the bubble, read the Dream panel, find the dream mate (New faces until
// its dream tag shows; a fresh set brings it about 1 in 4 times), look at the Gene Lab with the dream beside it, hatch the
// pair and check the card's "Dream match" line and its 16 row pegs.
const DREAM_PANEL = { role: "dialog", name: /^Dream (child|come true!)$/ };
const dreamToast = { note: "one-time toast: your Friend is dreaming", run: async ({ game }) => {
  await game.locator(".rb-toast").filter({ hasText: /^Friend #7730 is dreaming of a child\. Tap the bubble\.$/ }).waitFor({ timeout: 15_000 });
} };
/** Tap (or click) the thought bubble over the Friend: its box comes from the canvas's data-dream, mapped through data-view. */
const tapBubble = { note: "tap the dream bubble in the nursery", run: async ({ game, viewport }) => {
  const canvas = game.locator("canvas").first(), end = Date.now() + 10_000;
  let bubble = "";
  while (!(bubble = await canvas.getAttribute("data-dream") ?? "") && Date.now() < end) await new Promise(done => setTimeout(done, 100));
  if (!bubble) throw new Error("No dream bubble over the Friend");
  const [x0, y0, x1, y1] = bubble.split(",").map(Number), [left, top, width, height] = (await canvas.getAttribute("data-view")).split(",").map(Number);
  const box = await canvas.boundingBox();
  const position = { x: ((x0 + x1) / 2 - left) / width * box.width, y: ((y0 + y1) / 2 - top) / height * box.height };
  if (viewport.touch) await canvas.tap({ position }); else await canvas.click({ position });
} };
/** New faces until the dream mate's tag shows (the Wish would always bring it, but Hearts are short here). */
const findDreamMate = { note: "New faces until the dream mate shows its tag", run: async ({ game, viewport }) => {
  const tag = game.locator(".rb-pick-dream"), reroll = game.getByRole("button", { name: /^New faces/ });
  for (let tries = 0; !await tag.count(); tries++) {
    if (tries >= 60) throw new Error("The dream mate never came in 60 sets of new faces");
    if (viewport.touch) await reroll.tap(); else await reroll.click();
  }
  const card = tag.locator("xpath=ancestor::label[1]");
  if (viewport.touch) await card.tap(); else await card.click();
} };
const dreamPegs = { note: "16 row pegs on the baby, filled where the row matches the dream", run: async ({ game }) => {
  const pegs = await game.locator(".rb-card .rb-trio-slot-baby .rb-trio-dream-peg").count();
  const hits = await game.locator(".rb-card .rb-trio-slot-baby .rb-trio-dream-peg.rb-hit").count();
  const shown = Number((await game.locator(".rb-card .rb-trio-dream-note").textContent())?.match(/^(\d+) of 16 like the dream$/)?.[1]);
  if (pegs !== 16 || hits !== shown) throw new Error(`${pegs} pegs, ${hits} filled, the caption says ${shown}`);
} };
export const dreamSteps = [
  dreamToast,
  { wait: 400 },
  { screenshot: "dream-bubble" },
  { expect: { role: "button", name: "Your Friend's dream" }, note: "the HUD entry" },
  tapBubble,
  { waitFor: DREAM_PANEL },
  { expect: { css: ".rb-dream-clue" }, matches: /^Friend #7730 dreams of a child with an? [A-Z][a-z]+\.$/, note: "the clue: the mate's family" },
  { expect: { css: ".rb-dream-stats" }, matches: /Best matchNo try yet.*Eggs used0/ },
  { screenshot: "dream-panel" },
  { click: { role: "button", name: "Find the mate" } },
  { waitFor: { role: "dialog", name: /^(Find a match|Gene Lab)$/ } },
  { run: async ({ game, viewport }) => {
    // On offer already: the Gene Lab opens on the dream pair. Otherwise the Parents tab: find it, then open the lab.
    if (await game.getByRole("dialog", { name: "Gene Lab" }).count()) return;
    await findDreamMate.run({ game, viewport });
    const tab = game.getByRole("tab", { name: /^Gene Lab/ });
    if (viewport.touch) await tab.tap(); else await tab.click();
  }, note: "find the dream mate, then the Gene Lab" },
  { waitFor: { css: ".rb-dream-rows" }, note: "the dream beside the lab" },
  { expect: { css: ".rb-lab-possible" }, matches: /^\d+ of 630$/ },
  { wait: 400 },
  { screenshot: "dream-genelab" },
  { click: BREED },
  { confirm: "buy", expect: { title: "Buy egg", description: "1 egg for Friend #7730.", amount: "1 RF" } },
  { confirm: "play", expect: { title: "Use egg", description: "Use 1 egg from Friend #7730.", amount: null } },
  { waitFor: REVEAL, timeout: 20_000 },
  { expect: { css: ".rb-card-news" }, matches: /Dream (match: \d+ of 16 rows|come true! \+50 Hearts)/, note: "the card measures the baby against the dream" },
  dreamPegs,
  { screenshot: "reveal-dream" },
  { click: { role: "button", name: /Sanctuary.*\+/ } },
  { confirm: "redeem", expect: { title: "Redeem reward", description: "1 Common hatchling; simulated RF returns to this Friend.", amount: "0.5 RF" } },
  { waitFor: REVEAL, state: "detached" },
];

// nth 0: the intro tour draws its own sprite canvases after the world canvas.
const smoke = [{ waitFor: { css: "canvas", nth: 0 }, note: "world canvas mounted" }];

/** One hatch: Matchmaker -> Breed (buy + use egg confirmations) -> hatch reveal. `parentA`: index in Parent A's list (0 = your Friend). */
const hatch = ({ buys = true, timeout = 20_000, parentA = 0 } = {}) => [
  { click: FIND },
  ...(parentA ? [{ click: { css: ".rb-section-a .rb-pick", nth: parentA }, note: "a kept baby as Parent A" }] : []),
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
  { expect: { css: ".rb-trio-hint-new" }, contains: "Tap a row to see which real Friend it came from.", note: "one-time tip on the first result card" },
  { screenshot: "reveal-spotted" },
  { click: KEEP },
  heartsAtLeast(5, "Keep bonus: +5 Hearts"),
  // The second baby is an F2: the kept Spotted baby is its Parent A.
  ...hatch({ parentA: 1 }),
  { expect: { css: ".rb-card" }, contains: "Prismatic" },
  { expect: { css: ".rb-lineage" }, matches: /^Hatch #2 ·\sF2$/ },
  { waitFor: { css: ".rb-trio-hint-new" }, state: "detached", note: "the tip was one-time" },
  // Now and then an F2 keeps no row of your Friend (all of its F1 parent's rows it took came from the first mate).
  { expect: { css: ".rb-card-sources" }, matches: /^(\d+ of 16 rows are your Friend #7730 rest from #\d+ x\d+|Rows from 2 real Friends: #\d+ x\d+ · #\d+ x\d+$)/,
    note: "your Friend's share of its 16 rows first, then the other real Friends" },
  traceRowFromParentA,
  { expect: { css: ".rb-trio-now" }, matches: TRACED, note: "the path: origin Friend, family, the F1 it came through" },
  { waitFor: { css: ".rb-trio-origin", within: ".rb-trio-slot-a" }, only: "desktop", note: "origin portrait beside Parent A, its row level with theirs" },
  { waitFor: { css: ".rb-trio-now .rb-prov-portrait" }, only: "phone", note: "origin portrait in the caption" },
  { screenshot: "reveal-traced" },
  // Keyboard: Escape stops the trace first (the card stays), Enter traces row 1 again.
  { focus: { css: ".rb-card .rb-trio" }, only: "desktop" },
  { key: "Escape", only: "desktop" },
  { waitFor: { css: ".rb-trio-now" }, state: "detached", only: "desktop" },
  { expect: REVEAL, only: "desktop", note: "Escape cleared the trace, not the card" },
  { key: "Enter", only: "desktop" },
  { expect: { css: ".rb-trio-now" }, matches: /^Row 1 of /, only: "desktop" },
  rememberPrismatic,
  { click: KEEP },
  passOnTip,
  heartsAtLeast(10, "second Keep bonus"),
  // A kept Prismatic carries its shape mutations: picked as Parent A, the Matchmaker says what it can pass on.
  { click: FIND },
  { click: { css: ".rb-section-a .rb-pick", nth: 2 }, note: "the Prismatic baby as Parent A" },
  canPassOn,
  { screenshot: "match-pass-on" },
  // Gene Lab with the Prismatic as Parent A: a row and a shape locked, a third hatch (Common by the fixture's roll), the
  // card's lock marks and news, then a Sanctuary trade-in of the new baby (0.5 RF) so the rest of the run is unchanged.
  { click: LAB_TAB, only: "desktop" }, { tap: LAB_TAB, only: "phone" },
  { waitFor: { role: "dialog", name: "Gene Lab" } },
  { expect: { css: ".rb-lab-possible" }, matches: /^\d+ of 630$/, note: "possible babies of 630 masks" },
  labEdge,
  labRow,
  labShape,
  labCount,
  { expect: { css: ".rb-lab-cost" }, matches: /^\d+ locks?, (free|\d+ Hearts)/, note: "the cost line (first 3 locked rows free)" },
  { screenshot: "genelab" },
  { click: PARENTS_TAB, only: "desktop" }, { tap: PARENTS_TAB, only: "phone" },
  willPassOn,
  { expect: { css: ".rb-foot-lab" }, matches: /^Gene Lab: \d+ locks?, (free|\d+ Hearts)$/, note: "the Parents tab shows the lab's cost" },
  { click: BREED },
  { confirm: "buy", expect: { title: "Buy egg", description: "1 egg for Friend #7730.", amount: "1 RF" } },
  { confirm: "play", expect: { title: "Use egg", description: "Use 1 egg from Friend #7730.", amount: null } },
  { waitFor: REVEAL, timeout: 20_000 },
  { expect: { css: ".rb-card-news" }, matches: /Locked \d+ rows?, (all )?inherited/, note: "news: every locked row inherited" },
  { expect: { css: ".rb-lineage" }, matches: /^Hatch #3 ·\sF3$/, note: "the Prismatic F2 as Parent A makes an F3" },
  labMarks,
  { expect: { css: ".rb-trio-lock-note" }, matches: /^Locked rows? [\d, -]+$/, note: "the caption's lock note" },
  { screenshot: "reveal-locked" },
  traceLockedRow,
  { screenshot: "reveal-locked-traced" },
  { click: { role: "button", name: /Sanctuary.*\+/ } },
  { confirm: "redeem", expect: { title: "Redeem reward", description: "1 Common hatchling; simulated RF returns to this Friend.", amount: "0.5 RF" } },
  { waitFor: REVEAL, state: "detached" },
  // Dream child: the bubble, the panel, the dream mate, the lab beside the dream and a fourth hatch (Common, traded in: 0.5 RF).
  ...dreamSteps,
  { click: HEARTS, note: "Hearts counter opens the shop" },
  { waitFor: { role: "dialog", name: "Hearts shop" } },
  { screenshot: "shop" },
  { click: BUY_HAT, timeout: 45_000, note: "waits for the brood's income to reach 20 Hearts" },
  { click: PUT_ON },
  { waitFor: { role: "button", name: /^Take off/ }, note: "the Friend wears the Party hat" },
  { screenshot: "shop-hat" },
  { click: { role: "button", name: "Close Hearts shop" } },
  { click: { role: "button", name: /^Brood,/ } },
  { expect: { css: ".rb-collection-breeds" }, matches: /Breeds[234]\/45/, note: "two breeds in the book (up to four if the Gene Lab and dream babies found new ones)" },
  { screenshot: "brood" },
  { click: { role: "button", name: /Prismatic.*Show details/ } },
  { click: { role: "button", name: /Sanctuary.*\+/ } },
  { confirm: "redeem", expect: { title: "Redeem reward", description: "1 Prismatic hatchling; simulated RF returns to this Friend.", amount: "6 RF" } },
  { expect: { css: ".rb-hud-balance .rb-hud-num" }, matches: /^23 RF$/, note: "20 - 1 - 1 - 1 + 0.5 - 1 + 0.5 + 6 simulated RF" },
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
  { expect: { css: ".rb-hud-balance .rb-hud-num" }, matches: /^23 RF$/ },
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
  { expect: { css: ".rb-hud-balance .rb-hud-num" }, matches: /^24 RF$/, note: "the 1 RF stake came back as the trade-in" },
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
