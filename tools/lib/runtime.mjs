// Shared helpers for the dev tools in tools/: in-frame runtime confirmations, forced preview
// rolls, a mocked runtime launcher for recordings, and a small data-driven step runner.
// Automated testing only. The mock wallet never reaches a build or a published preview.
import assert from "node:assert/strict";
import { mkdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseChanceGame } from "../../dist/game.js";

export const SDK_ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const DEFAULT_GAME = join(SDK_ROOT, "games/rare-breeds");
/** Viewports used by tools/test-game.mjs. testGame enables touch automatically below 500 px. */
export const VIEWPORTS = Object.freeze({
  desktop: Object.freeze({ name: "desktop", width: 960, height: 800, touch: false }),
  phone: Object.freeze({ name: "phone", width: 390, height: 844, touch: true }),
});
/** The fixture pins crypto.getRandomValues(new Uint32Array(1)) to 1500 in every frame. */
export const FIXTURE_ROLL = 1500;

export async function readDefinition(gameDirectory) {
  return parseChanceGame(JSON.parse(await readFile(join(gameDirectory, "game.json"), "utf8")));
}

/** Titles of the trusted runtime confirmations (src/game-host.tsx authorize). */
export function confirmationTitles(definition) {
  const item = definition.consumable.toLowerCase();
  return Object.freeze({ buy: `Buy ${item}`, play: `Use ${item}`, redeem: "Redeem reward", settle: "Resolve result" });
}

/** First contract roll of each outcome, index = outcomeId - 1. */
export function outcomeStartRolls(definition) {
  let start = 0;
  return definition.outcomes.map(outcome => { const roll = start; start += outcome.chanceBps; return roll; });
}

/** Accepts an outcomeId (1-based), an exact outcome name, or a case-insensitive name prefix ("prismatic"). */
export function outcomeIdFor(definition, tier) {
  if (Number.isInteger(tier)) {
    assert(tier >= 1 && tier <= definition.outcomes.length, `Unknown outcome ${tier}`);
    return tier;
  }
  const wanted = String(tier).toLowerCase();
  const index = definition.outcomes.findIndex(outcome => outcome.name.toLowerCase() === wanted || outcome.name.toLowerCase().startsWith(wanted));
  assert(index >= 0, `Unknown outcome "${tier}". Outcomes: ${definition.outcomes.map(outcome => outcome.name).join(", ")}`);
  return index + 1;
}

/**
 * Queue the preview ledger's next rolls. The ledger lives in the trusted page and draws one
 * crypto.getRandomValues(new Uint32Array(1)) per settle, so overriding it there scripts the tiers.
 * After the queue is empty the fallback roll is used (fixture parity), or native randomness when null.
 */
export async function forceRolls(page, rolls, fallback = FIXTURE_ROLL) {
  for (const roll of rolls) assert(Number.isInteger(roll) && roll >= 0 && roll < 10_000, `Invalid roll ${roll}`);
  await page.evaluate(({ rolls, fallback }) => {
    const queue = [...rolls], native = Crypto.prototype.getRandomValues;
    crypto.getRandomValues = function (array) {
      if (array instanceof Uint32Array && array.length === 1 && (queue.length || fallback !== null)) {
        array[0] = queue.length ? queue.shift() : fallback;
        return array;
      }
      return native.call(crypto, array);
    };
  }, { rolls, fallback });
}

const CONFIRM_BUTTON = /^Confirm( preview)?$/;

function confirmationDialog(page, title) {
  const dialogs = page.locator(".rf-frame-scrim .rf-frame-menu[role=dialog]");
  return title ? page.getByRole("dialog", { name: title, exact: true }) : dialogs.filter({ has: page.getByRole("button", { name: CONFIRM_BUTTON }) });
}

/** Wait for a runtime confirmation (in the trusted page, not the game iframe) and read its text. */
export async function readConfirmation(page, title, timeout) {
  const dialog = confirmationDialog(page, title);
  await dialog.waitFor({ timeout });
  const lines = (await dialog.locator(".rf-frame-menu-body p").allTextContents()).map(text => text.trim());
  const amount = await dialog.locator(".rf-frame-menu-body strong").count() ? (await dialog.locator(".rf-frame-menu-body strong").textContent()).trim() : null;
  return { dialog, title: (await dialog.locator("h2").textContent()).trim(), description: lines[0], amount, lines };
}

function checkConfirmation(details, expected = {}) {
  for (const [key, value] of Object.entries(expected)) {
    const actual = details[key];
    if (value instanceof RegExp) assert.match(actual ?? "", value, `confirmation ${key}`);
    else assert.equal(actual, value, `confirmation ${key}`);
  }
}

export function createHelpers({ page, game, definition, viewport, mediaDirectory, prefix = "", log = console.log }) {
  const titles = confirmationTitles(definition);
  const titleFor = name => titles[name] ?? name;
  const confirmations = [];
  let touch = null;
  async function respond(name, button, { expect, timeout } = {}) {
    const details = await readConfirmation(page, name ? titleFor(name) : undefined, timeout);
    checkConfirmation(details, expect);
    confirmations.push({ title: details.title, description: details.description, amount: details.amount, action: button === "confirm" ? "confirmed" : "cancelled" });
    await details.dialog.getByRole("button", button === "confirm" ? { name: CONFIRM_BUTTON } : { name: "Cancel", exact: true }).click();
    await details.dialog.waitFor({ state: "hidden", timeout });
    const { dialog, ...plain } = details;
    return plain;
  }
  return {
    titles, confirmations,
    /** Confirm "buy" | "play" | "redeem" | a literal title | undefined (any confirmation). */
    confirm: (name, options) => respond(name, "confirm", options),
    cancel: (name, options) => respond(name, "cancel", options),
    forceRolls: (rolls, fallback) => forceRolls(page, rolls, fallback),
    /** Same queue inside the sandboxed game frame, for rolls the game draws itself (samplePreviewRoll, e.g. a crash point). */
    forceGameRolls: async (rolls, fallback) => forceRolls(await (await page.locator("iframe").elementHandle()).contentFrame(), rolls, fallback),
    forceTiers: (tiers, fallback) => forceRolls(page, tiers.map(tier => outcomeStartRolls(definition)[outcomeIdFor(definition, tier) - 1]), fallback),
    locate: spec => locate({ page, game }, spec),
    /**
     * Press and hold a target ("down"), then let go ("up", wherever it is now): a real touch on touch viewports
     * (Chromium CDP touch events, so the page sees touch pointers), the mouse otherwise, or Space with via "key".
     */
    async press(spec, phase, via = viewport?.touch ? "touch" : "mouse") {
      if (phase === "up") {
        if (via === "key") await page.keyboard.up("Space");
        else if (via === "mouse") await page.mouse.up();
        else await touch?.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        return;
      }
      const target = locate({ page, game }, spec);
      if (via === "key") { await target.focus(); await page.keyboard.down("Space"); return; }
      const box = await target.boundingBox();
      assert(box, `No visible ${describe(spec)} to press`);
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      if (via === "mouse") { await page.mouse.move(x, y); await page.mouse.down(); return; }
      touch ??= await page.context().newCDPSession(page);
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    },
    /** Click or tap the game canvas at logical world coordinates (default logical size 960 x 640). */
    async world([x, y], { canvas = "canvas", logical = [960, 640] } = {}) {
      const target = game.locator(canvas).first(), box = await target.boundingBox();
      assert(box, `No visible ${canvas} in the game frame`);
      const position = { x: x / logical[0] * box.width, y: y / logical[1] * box.height };
      if (viewport.touch) await target.tap({ position }); else await target.click({ position });
    },
    async screenshot(name, of = "frame") {
      await mkdir(mediaDirectory, { recursive: true });
      const path = join(mediaDirectory, `${prefix}${name}${viewport ? `-${viewport.name}` : ""}.png`);
      const target = of === "page" ? page : of === "frame" ? page.locator(".rf-game-frame") : locate({ page, game }, of);
      await target.screenshot({ path });
      log(`    screenshot ${path}`);
      return path;
    },
  };
}

/**
 * Target spec: "exact text" | { text } | { role, name } | { label } | { css } | { testId },
 * plus in: "page" for the trusted runtime page (default: the game iframe), within: css, nth: n.
 * Strings match exactly; RegExp values match partially.
 */
export function locate({ page, game }, spec) {
  if (typeof spec === "string" || spec instanceof RegExp) spec = { text: spec };
  let root = spec.in === "page" ? page : game;
  if (spec.within) root = root.locator(spec.within);
  const exact = value => spec.exact ?? typeof value === "string";
  let locator;
  if (spec.role) locator = root.getByRole(spec.role, spec.name === undefined ? {} : { name: spec.name, exact: exact(spec.name) });
  else if (spec.text !== undefined) locator = root.getByText(spec.text, { exact: exact(spec.text) });
  else if (spec.label !== undefined) locator = root.getByLabel(spec.label, { exact: exact(spec.label) });
  else if (spec.css) locator = root.locator(spec.css);
  else if (spec.testId) locator = root.getByTestId(spec.testId);
  else throw new Error(`Unsupported target ${describe(spec)}`);
  return spec.nth === undefined ? locator : locator.nth(spec.nth);
}

function describe(value) {
  if (typeof value === "function") return "[function]";
  return JSON.stringify(value, (_key, item) => item instanceof RegExp ? String(item) : typeof item === "bigint" ? `${item}n` : item);
}

async function poll(read, test, timeout, message) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await read();
    if (test(last)) return last;
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error(`${message}; last value: ${JSON.stringify(last)}`);
}

/**
 * Run data-driven steps. Every step may carry only: "desktop" | "phone" and a note.
 *   { click: target }  { tap: target }  { hover: target }  { focus: target }
 *   { world: [x, y], canvas?, logical? }   click/tap the canvas at logical coordinates
 *   { key: "ArrowRight", hold?: ms }   { type: "text" }   { wait: ms }
 *   { down: target, via?: "mouse" | "touch" | "key" }  { up: target, via? }   press and keep holding, then let go (default touch on touch viewports; up needs no target)
 *   { waitFor: target, state?: "visible" | "hidden" | "attached" | "detached", timeout? }
 *   { expect: target, contains?: string, matches?: RegExp, timeout? }
 *   { confirm: "buy" | "play" | "redeem" | title, expect?: { title?, description?, amount? } }
 *   { cancel: "buy" | "play" | "redeem" | title }
 *   { tiers: ["prismatic", 2, "Common hatchling"] }   { rolls: [9750] }   force the next settles
 *   { gameRolls: [0] }   queue the game frame's own next rolls (samplePreviewRoll in the game, e.g. the slingshot crash point)
 *   { mark: "name" }   record-video: note the time of this moment in the take (ctx.mark, <name>-marks.json, cuts)
 *   { screenshot: "name", of?: "frame" | "page" | target }
 *   { run: async ctx => {} }   { log: "message" }
 */
export async function runSteps(ctx, steps, { label = "", log = console.log } = {}) {
  const { page, helpers, viewport } = ctx;
  const timeout = ctx.timeout ?? 15_000;
  for (const [index, step] of steps.entries()) {
    if (step.only && viewport && step.only !== viewport.name) continue;
    const kind = Object.keys(step).find(key => !["only", "note", "state", "timeout", "hold", "expect", "contains", "matches", "canvas", "logical", "of", "fallback", "via"].includes(key))
      ?? (step.expect !== undefined ? "expect" : undefined);
    log(`  ${label}${index + 1}/${steps.length} ${kind} ${describe(step[kind]).slice(0, 90)}${step.note ? ` (${step.note})` : ""}`);
    try {
      switch (kind) {
        case "click": await helpers.locate(step.click).click({ timeout: step.timeout }); break;
        case "tap": await helpers.locate(step.tap).tap({ timeout: step.timeout }); break;
        case "hover": await helpers.locate(step.hover).hover({ timeout: step.timeout }); break;
        case "focus": await helpers.locate(step.focus).focus({ timeout: step.timeout }); break;
        case "world": await helpers.world(step.world, step); break;
        case "key":
          if (step.hold) { await page.keyboard.down(step.key); await page.waitForTimeout(step.hold); await page.keyboard.up(step.key); }
          else await page.keyboard.press(step.key);
          break;
        case "down": await helpers.press(step.down, "down", step.via); break;
        case "up": await helpers.press(step.up, "up", step.via); break;
        case "type": await page.keyboard.type(step.type); break;
        case "wait": await page.waitForTimeout(step.wait); break;
        case "waitFor": await helpers.locate(step.waitFor).waitFor({ state: step.state ?? "visible", timeout: step.timeout }); break;
        case "expect": {
          const locator = helpers.locate(step.expect);
          await locator.waitFor({ timeout: step.timeout });
          if (step.contains !== undefined || step.matches) {
            await poll(() => locator.textContent(), text => step.matches ? step.matches.test(text ?? "") : (text ?? "").includes(step.contains),
              step.timeout ?? timeout, `Expected ${describe(step.expect)} to ${step.matches ? `match ${step.matches}` : `contain "${step.contains}"`}`);
          }
          break;
        }
        case "confirm": log(`    confirmed ${describe(await helpers.confirm(step.confirm, { expect: step.expect, timeout: step.timeout }))}`); break;
        case "cancel": log(`    cancelled ${describe(await helpers.cancel(step.cancel, { expect: step.expect, timeout: step.timeout }))}`); break;
        case "tiers": await helpers.forceTiers(step.tiers, step.fallback); break;
        case "rolls": await helpers.forceRolls(step.rolls, step.fallback); break;
        case "gameRolls": await helpers.forceGameRolls(step.gameRolls, step.fallback); break;
        case "mark": ctx.mark?.(step.mark); break;
        case "screenshot": await helpers.screenshot(step.screenshot, step.of); break;
        case "run": await step.run(ctx); break;
        case "log": log(`    ${step.log}`); break;
        default: throw new Error("Unknown step kind");
      }
    } catch (error) {
      throw new Error(`Step ${index + 1} ${describe(step)} failed: ${error.message}`, { cause: error });
    }
  }
}

/** Load a scenario module: named exports `test` and `video`, each an array of steps or async (ctx) => {}. */
export async function loadScenario(path) {
  if (!path) return {};
  const file = resolve(path);
  await stat(file);
  const module = await import(pathToFileURL(file).href);
  return { file, test: module.test, video: module.video, cut: module.cut, ready: module.ready, tiers: module.tiers };
}

export async function runScenarioPart(part, ctx, options) {
  if (!part) return false;
  if (typeof part === "function") await part(ctx);
  else await runSteps(ctx, part, options);
  return true;
}

/** Default scenario for a game directory: tools/scenarios/<game-name>.mjs when it exists. */
export async function defaultScenarioPath(gameDirectory) {
  const candidate = join(SDK_ROOT, "tools/scenarios", `${basename(resolve(gameDirectory))}.mjs`);
  try { await stat(candidate); return candidate; } catch { return undefined; }
}

/**
 * Same flow as the SDK's testGame (scripts/testing.mjs): mocked wallet, RPC and #7730 artwork,
 * the real runtime, ownership gate and sandbox. Used where testGame has no option (video, custom
 * reduced motion, prebuilt static folders). `origin` is the served origin (the fixture lets only it and
 * the mocked RPC through); `url` may add a sub-path such as a GitHub Pages repository path.
 * Returns once the game document has mounted.
 */
export async function openMockRuntime(browser, origin, { viewport, reducedMotion = "reduce", recordVideo, timeout = 15_000, url = origin } = {}) {
  const { installFixture, createArtworkFixture, assertBounds } = await import("../../scripts/browser-fixture.mjs");
  const errors = [];
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: Boolean(viewport.touch), reducedMotion, recordVideo });
  await context.routeWebSocket("**/*", socket => { errors.push(`Unexpected WebSocket: ${socket.url()}`); socket.close(); });
  const page = await context.newPage();
  const startedAt = Date.now();
  page.setDefaultTimeout(timeout);
  page.setDefaultNavigationTimeout(timeout);
  page.on("pageerror", error => errors.push(error.message));
  const fixture = await installFixture(page, origin, { artworkCall: await createArtworkFixture() });
  const game = page.frameLocator("iframe");
  await page.goto(url);
  await page.getByRole("button", { name: /^Connect (wallet|Browser wallet)$/ }).click();
  await page.getByRole("button", { name: /^Friend #7730\b/ }).click();
  await page.locator("iframe").waitFor();
  await game.locator("#root > *").first().waitFor();
  await game.getByText("Waiting for your Friend…", { exact: true }).waitFor({ state: "hidden" });
  await page.locator(".rf-runtime-status").waitFor({ state: "hidden" });
  assert(fixture.ownerReads >= 2, "The runtime must freshly verify the fixture identity");
  assert.equal(await page.locator("iframe").getAttribute("sandbox"), "allow-scripts");
  await assertBounds(page);
  return {
    context, page, game, fixture, startedAt,
    /** Browser and fixture errors collected so far. */
    errors: () => [...errors, ...fixture.errors],
    signedNothing: async () => (await page.evaluate(() => window.__friendWalletTest.state.requests)).every(method =>
      ["eth_accounts", "eth_requestAccounts", "eth_chainId", "wallet_switchEthereumChain"].includes(method)),
  };
}

export const relativeToRoot = path => path.startsWith(SDK_ROOT) ? path.slice(SDK_ROOT.length) : path;
