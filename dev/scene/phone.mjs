// Dev-only: the integrated Rare Breeds game in the SDK's mocked runtime (same fixture as tools/test-game.mjs)
// at a phone viewport with a real phone's pixel density, screenshotting a full flow to judge the camera.
// Usage: node dev/scene/phone.mjs [--width 390] [--height 844] [--dpr 3] [--reduced] [--aspect "3 / 4"] [--out dev/scene/shots/game]
// --aspect previews a game-level host.css (--rf-game-aspect-ratio) by injecting it into the runtime page.
// Screenshots: <out>/game-<width>-<step>.png (the runtime's game frame) plus one full-page shot.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { buildGame } from "@rarefriends/friendsdk/build";
import { createGameServer } from "@rarefriends/friendsdk/serve";
import { DEFAULT_GAME, createHelpers, openMockRuntime, readDefinition, runSteps } from "../../tools/lib/runtime.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: {
  width: { type: "string" }, height: { type: "string" }, dpr: { type: "string" }, reduced: { type: "boolean" }, out: { type: "string" },
  aspect: { type: "string" },
} });
const width = Number(values.width ?? 390), height = Number(values.height ?? 844), dpr = Number(values.dpr ?? 3);
const out = resolve(values.out ?? join(here, "shots/game"));
const viewport = Object.freeze({ name: "phone", width, height, touch: width < 500 });
const tag = `${width}${values.reduced ? "-reduced" : ""}${values.aspect ? `-aspect-${values.aspect.replace(/\W+/g, "x")}` : ""}`;
await mkdir(out, { recursive: true });

const FIND = { role: "button", name: /^Find a match/ };
const BREED = { role: "button", name: /^(Buy egg & breed|Breed ·)/ };
const REVEAL = { role: "dialog", name: "Your new baby" };

const definition = await readDefinition(DEFAULT_GAME);
const temporary = await mkdtemp(join(tmpdir(), "rare-breeds-phone-"));
let build, server, browser, failures = 0;
const check = (ok, message) => { console.log(`${ok ? "PASS" : "FAIL"} ${message}`); if (!ok) failures++; };
try {
  build = await buildGame(DEFAULT_GAME, { outdir: join(temporary, "dist") });
  server = createGameServer(build.outdir);
  await new Promise((done, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", done); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const real = await chromium.launch({ headless: true });
  browser = real;
  // openMockRuntime has no pixel-density option: add it (and mobile emulation) on the way through.
  const phone = { newContext: options => real.newContext({ ...options, deviceScaleFactor: dpr, isMobile: viewport.touch }) };
  const session = await openMockRuntime(phone, origin, { viewport, reducedMotion: values.reduced ? "reduce" : "no-preference", timeout: 20_000 });
  const { page, game } = session;
  if (values.aspect) {
    await page.addStyleTag({ content: `:root { --rf-game-aspect-ratio: ${values.aspect}; }` });
    await page.waitForTimeout(400);
  }
  const helpers = createHelpers({ page, game, definition, viewport, mediaDirectory: out, prefix: "game-", log: () => {} });
  const ctx = { page, game, viewport, definition, helpers, timeout: 20_000 };
  const canvas = game.locator("canvas.rb-world-canvas");
  const shot = async name => {
    const path = join(out, `game-${tag}-${name}.png`);
    await page.locator(".rf-game-frame").screenshot({ path });
    console.log(`  shot ${path}`);
  };
  const read = () => canvas.evaluate(node => ({ ...node.dataset }));
  /** Tap a world point through the scene camera (data-view: left, top, width, height, zoom). */
  const tapWorld = async (x, y) => {
    const { view } = await read();
    const [left, top, w, h] = view.split(",").map(Number);
    const box = await canvas.boundingBox();
    const scale = Math.min(box.width / w, box.height / h);
    const position = { x: (box.width - w * scale) / 2 + (x - left) * scale, y: (box.height - h * scale) / 2 + (y - top) * scale };
    // Like a player: only tap floor that shows between the HUD and the action bar.
    position.x = Math.min(Math.max(position.x, 10), box.width - 10);
    position.y = Math.min(Math.max(position.y, 50), box.height - 95);
    if (process.env.DEBUG_TAPS) console.log(`  tap world (${x}, ${y}) -> css (${position.x.toFixed(0)}, ${position.y.toFixed(0)}) view ${view} player ${(await read()).playerX},${(await read()).playerY}`);
    if (viewport.touch) await canvas.tap({ position }); else await canvas.click({ position });
  };
  /** The Friend on screen: CSS px inside the canvas box, and its 16-row frame height. */
  const hero = async () => {
    const { view, playerX, playerY } = await read();
    const [left, top, w, h, zoom] = view.split(",").map(Number);
    const box = await canvas.boundingBox();
    const scale = Math.min(box.width / w, box.height / h);
    return { x: (Number(playerX) - left) * scale, y: (Number(playerY) - 28 - top) * scale, frame: 64 * scale, zoom, box };
  };
  const hatch = async ({ keep, frames = [] }) => {
    await runSteps(ctx, [{ click: FIND }], { log: () => {} });
    await page.waitForTimeout(400);
    await shot(`${keep}-match-panel`);
    await runSteps(ctx, [{ click: BREED }], { log: () => {} });
    try { await helpers.confirm("buy", { timeout: 4000 }); } catch { /* an egg was already waiting */ }
    await helpers.confirm("play", { timeout: 20_000 });
    const started = Date.now();
    for (const at of frames) { await page.waitForTimeout(Math.max(0, at - (Date.now() - started))); await shot(`${keep}-courtship-${at}`); }
    await game.getByRole(REVEAL.role, { name: REVEAL.name }).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(300);
    await shot(`${keep}-reveal`);
  };

  await page.waitForTimeout(1600);
  await shot("01-intro");
  await page.screenshot({ path: join(out, `game-${tag}-page.png`) });
  const start = await hero();
  console.log(`  frame ${start.box.width.toFixed(0)} x ${start.box.height.toFixed(0)} CSS px, zoom ${start.zoom}, Friend frame ${start.frame.toFixed(1)} CSS px at (${start.x.toFixed(0)}, ${start.y.toFixed(0)})`);
  if (start.box.width < 600) {
    check(start.zoom > 1.5, `compact frame zooms in (zoom ${start.zoom})`);
    check(start.frame >= 44 && start.frame <= 60, `the Friend's frame is ${start.frame.toFixed(1)} CSS px tall`);
  }
  // Walk left on the rug, then up towards the incubator.
  await tapWorld(330, 420);
  await page.waitForTimeout(500);
  await shot("02-walking");
  await page.waitForTimeout(1200);
  await shot("03-walked");
  const walked = await read();
  check(Number(walked.playerX) < 380, `tap to walk through the camera reaches the target (${walked.playerX}, ${walked.playerY})`);
  await tapWorld(470, 300);
  await page.waitForTimeout(1300);
  await tapWorld(470, 236);
  await page.waitForTimeout(1300);
  await shot("04-incubator");
  const atIncubator = await read();
  check(atIncubator.near === "incubator", `walking up reaches the incubator (near=${atIncubator.near}, ${atIncubator.playerX}, ${atIncubator.playerY})`);
  const up = await hero();
  check(up.y > 40 && up.y < up.box.height - 80, `the Friend stays in the band under the HUD and above the action bar (y ${up.y.toFixed(0)})`);

  await helpers.forceTiers(["spotted", "mutant", "prismatic"]);
  await hatch({ keep: "h1", frames: values.reduced ? [200] : [250, 700, 1150, 1600, 2050] });
  await runSteps(ctx, [{ click: { role: "button", name: "Keep" } }], { log: () => {} });
  await page.waitForTimeout(350);
  await shot("h1-kept");
  await page.waitForTimeout(1800);
  await shot("h1-family");

  await hatch({ keep: "h2", frames: [] });
  await runSteps(ctx, [{ click: { role: "button", name: "Keep" } }], { log: () => {} });
  await page.waitForTimeout(2200);
  await shot("h2-family");
  await tapWorld(620, 470);
  await page.waitForTimeout(1800);
  await shot("h2-family-walked");

  await hatch({ keep: "h3", frames: [] });
  await runSteps(ctx, [{ click: { role: "button", name: /Sanctuary.*\+/ } }], { log: () => {} });
  await helpers.confirm("redeem", { timeout: 20_000 });
  const released = Date.now();
  for (const at of values.reduced ? [150, 700] : [300, 900, 1500, 2100, 2700, 3600]) {
    await page.waitForTimeout(Math.max(0, at - (Date.now() - released)));
    await shot(`h3-release-${at}`);
  }
  await page.waitForTimeout(1500);
  await shot("h3-after-release");
  const end = await read();
  check(end.brood === "2", `two babies follow the Friend after the release (brood=${end.brood})`);
  assert.deepEqual(session.errors(), [], "Game browser errors");
  console.log("No browser errors.");
} finally {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  await build?.close();
  await rm(temporary, { recursive: true, force: true });
}
console.log(failures ? `${failures} check(s) failed` : "All checks passed");
process.exitCode = failures ? 1 : 0;
