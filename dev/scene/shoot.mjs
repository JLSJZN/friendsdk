// Dev-only: screenshots and behaviour checks for the scene harness (headless Chromium, fake clock).
// Usage: node dev/scene/shoot.mjs [nursery] [small] [phone] [hatch] [courtship] [release] [reduced] [checks]   (default: all)
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./serve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, "shots");
await mkdir(shots, { recursive: true });
const wanted = new Set(process.argv.slice(2));
const run = name => wanted.size === 0 || wanted.has(name);

const server = await startServer();
const browser = await chromium.launch();
const problems = [];
let failures = 0;
const check = (ok, message) => { console.log(`${ok ? "PASS" : "FAIL"} ${message}`); if (!ok) failures++; };

async function open(query, { width = 960, height = 640, scale = 1, touch = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  page.on("console", message => { if (message.type() === "error" || message.type() === "warning") problems.push(`[${query}] console.${message.type()}: ${message.text()}`); });
  page.on("pageerror", error => problems.push(`[${query}] pageerror: ${error.message}`));
  await page.clock.install({ time: 0 });
  await page.goto(`${server.url}?clean=1&${query}`);
  await page.waitForFunction(() => !!window.__harness);
  // Freeze real time so every runFor() below is exact (the installed clock otherwise keeps flowing).
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 250);
  await page.clock.runFor(600);
  return { page, context };
}
const shot = (page, name) => page.screenshot({ path: join(shots, `${name}.png`) });
/** World (logical) point to client CSS px through the scene camera (canvas data-view: left,top,width,height,zoom). */
const toClient = (page, x, y) => page.evaluate(([x, y]) => {
  const canvas = document.getElementById("world");
  const [left, top, width, height] = canvas.dataset.view.split(",").map(Number);
  const box = canvas.getBoundingClientRect();
  const scale = Math.min(box.width / width, box.height / height);
  return { x: box.left + (box.width - width * scale) / 2 + (x - left) * scale, y: box.top + (box.height - height * scale) / 2 + (y - top) * scale };
}, [x, y]);
/** Centre of the part of a world rect that is visible between the stand-in HUD (44 CSS px) and action bar (88 CSS px). */
const visibleTarget = (page, [x0, y0, x1, y1]) => page.evaluate(([x0, y0, x1, y1]) => {
  const canvas = document.getElementById("world");
  const [left, top, width, height] = canvas.dataset.view.split(",").map(Number);
  const scale = canvas.getBoundingClientRect().height / height;
  const bandTop = top + 44 / scale, bandBottom = top + height - 88 / scale;
  const a = Math.max(x0, left + 4), b = Math.min(x1, left + width - 4), c = Math.max(y0, bandTop), d = Math.min(y1, bandBottom);
  return a < b && c < d ? { x: (a + b) / 2, y: (c + d) / 2 } : null;
}, [x0, y0, x1, y1]);
/** Walk like a phone player: keep tapping the visible point of the band nearest the goal until the Friend is there. */
async function walkTo(page, x, y, { tries = 8, step = 1200 } = {}) {
  for (let i = 0; i <= tries; i++) {
    const { px, py } = await page.evaluate(() => { const c = document.getElementById("world"); return { px: Number(c.dataset.playerX), py: Number(c.dataset.playerY) }; });
    if (Math.hypot(px - x, py - y) < 16) return true;
    if (i === tries) break;
    const spot = await page.evaluate(([x, y]) => {
      const canvas = document.getElementById("world");
      const [left, top, width, height] = canvas.dataset.view.split(",").map(Number);
      const scale = canvas.getBoundingClientRect().height / height;
      return { x: Math.min(Math.max(x, left + 12), left + width - 12), y: Math.min(Math.max(y, top + 50 / scale), top + height - 96 / scale) };
    }, [x, y]);
    const tap = await toClient(page, spot.x, spot.y);
    await page.touchscreen.tap(tap.x, tap.y);
    await page.clock.runFor(step);
  }
  return false;
}
const camera = page => page.evaluate(() => {
  const [x, y, width, height, zoom] = document.getElementById("world").dataset.view.split(",").map(Number);
  return { x, y, width, height, zoom };
});
/** Where the Friend is on screen (CSS px, relative to the frame) and how tall its 16-row frame is there. */
const heroOnScreen = page => page.evaluate(() => {
  const canvas = document.getElementById("world");
  const [left, top, width, height] = canvas.dataset.view.split(",").map(Number);
  const box = canvas.getBoundingClientRect();
  const scale = Math.min(box.width / width, box.height / height);
  const x = Number(canvas.dataset.playerX), y = Number(canvas.dataset.playerY);
  return { x: (x - left) * scale, y: (y - 28 - top) * scale, frame: 64 * scale };
});
const state = page => page.evaluate(() => {
  const canvas = document.getElementById("world");
  return { x: Number(canvas.dataset.playerX), y: Number(canvas.dataset.playerY), near: canvas.dataset.near, log: [...window.__harness.log] };
});

try {
  if (run("nursery")) {
    const { page, context } = await open("babies=4&eggs=3");
    await page.clock.runFor(1500);
    await shot(page, "nursery-960");
    await page.keyboard.down("ArrowRight");
    await page.clock.runFor(330);
    await shot(page, "nursery-walking");
    await page.keyboard.up("ArrowRight");
    await page.clock.runFor(900);
    await shot(page, "nursery-after-walk");
    await context.close();
  }

  if (run("small")) {
    const { page, context } = await open("babies=3&eggs=1&w=360", { width: 360, height: 240, scale: 3, touch: true });
    await page.clock.runFor(1200);
    await shot(page, "nursery-360");
    const view = await camera(page);
    check(view.zoom > 1.9 && view.width < 480, `360 px frame zooms in (zoom ${view.zoom}, ${view.width} x ${view.height} logical visible)`);
    await walkTo(page, 480, 250); // in front of the incubator, tapping only what the camera shows
    await page.clock.runFor(400);
    await shot(page, "nursery-360-tap-prompt");
    check((await state(page)).near === "incubator", "tap-to-walk on a phone reaches the incubator");
    await context.close();
  }

  if (run("phone")) {
    // The integrated game's phone frame: 390 x 260 CSS px at DPR 3, with stand-ins for the UI chrome.
    const { page, context } = await open("babies=3&eggs=1&w=390&chrome=1", { width: 390, height: 260, scale: 3, touch: true });
    await page.clock.runFor(1400);
    await shot(page, "phone-intro");
    const hero = await heroOnScreen(page);
    check(hero.frame >= 48 && hero.frame <= 58, `phone: the Friend's frame is ${hero.frame.toFixed(1)} CSS px tall`);
    check(hero.y > 44 && hero.y < 172, `phone: the Friend sits in the band between the HUD and the action bar (y ${hero.y.toFixed(0)})`);
    // Tap to walk left towards the Matchmaker: the camera follows.
    const before = await camera(page);
    const left = await toClient(page, 300, 420);
    await page.touchscreen.tap(left.x, left.y);
    await page.clock.runFor(350);
    await shot(page, "phone-walking");
    await page.clock.runFor(1600);
    const after = await camera(page);
    check(after.x < before.x - 60, `phone: the camera follows the Friend (${before.x} -> ${after.x})`);
    await shot(page, "phone-walked");
    // Walk up, then tap the part of the Matchmaker that shows in the band: walks there, activates, prompt visible.
    const up = await toClient(page, 280, 330);
    await page.touchscreen.tap(up.x, up.y);
    await page.clock.runFor(1600);
    await shot(page, "phone-up");
    const spot = await visibleTarget(page, [36, 168, 171, 327]);
    check(!!spot, `phone: part of the Matchmaker shows in the band after walking up (${JSON.stringify(spot)})`);
    const kiosk = await toClient(page, spot?.x ?? 100, spot?.y ?? 300);
    await page.touchscreen.tap(kiosk.x, kiosk.y);
    await page.clock.runFor(2600);
    check((await state(page)).log.includes("activate:matchmaker"), "phone: tapping the Matchmaker through the camera walks there and activates it");
    await shot(page, "phone-matchmaker");
    // Bottom of the room: the Friend stays above the action bar.
    check(await walkTo(page, 560, 600), `phone: walked to the front wall with visible taps (${JSON.stringify(await state(page)).slice(0, 60)})`);
    await page.clock.runFor(1200);
    const deep = await heroOnScreen(page);
    check(deep.y > 44 && deep.y < 172, `phone: at the front wall the Friend stays between HUD and action bar (y ${deep.y.toFixed(0)})`);
    await shot(page, "phone-front-wall");
    // Courtship frames the mate and the Friend.
    await page.evaluate(() => { window.__courtDone = false; window.__harness.courtship(7).then(() => { window.__courtDone = true; }); });
    let now = 0;
    for (const at of [300, 800, 1300, 1800]) { await page.clock.runFor(at - now); now = at; await shot(page, `phone-courtship-${String(at).padStart(4, "0")}`); }
    await page.clock.runFor(1200);
    check(await page.evaluate(() => window.__courtDone), "phone: courtship resolves");
    // Release follows the baby to the gate.
    await page.evaluate(() => { window.__relDone = false; window.__harness.release().then(() => { window.__relDone = true; }); });
    now = 0;
    for (const at of [700, 1500, 2300, 3000]) { await page.clock.runFor(at - now); now = at; await shot(page, `phone-release-${String(at).padStart(4, "0")}`); }
    await page.clock.runFor(2500);
    check(await page.evaluate(() => window.__relDone), "phone: release resolves");
    await shot(page, "phone-after-release");
    await context.close();
    // Reduced motion: the camera snaps (no easing): one frame after a move the camera is where it settles.
    const reduced = await open("babies=2&w=390&chrome=1&reduced=1", { width: 390, height: 260, scale: 3, touch: true });
    const start = await camera(reduced.page);
    const far = await toClient(reduced.page, 270, 470);
    await reduced.page.touchscreen.tap(far.x, far.y);
    await reduced.page.clock.runFor(2600);
    const settled = await camera(reduced.page);
    await reduced.page.clock.runFor(600);
    const later = await camera(reduced.page);
    check(settled.x < start.x && settled.x === later.x && settled.y === later.y, `phone reduced motion: camera snapped and holds (${start.x} -> ${settled.x} -> ${later.x})`);
    await shot(reduced.page, "phone-reduced");
    await reduced.context.close();
  }

  if (run("hatch")) {
    for (const tier of (process.env.TIERS ?? "prismatic,mutant,spotted,common").split(",")) {
      const { page, context } = await open(`babies=2&tier=${tier}`);
      await page.evaluate(() => { window.__hatchDone = false; window.__harness.hatch().then(() => { window.__hatchDone = true; }); });
      const moments = tier === "prismatic" ? [300, 700, 1200, 1600, 1900, 2090, 2400, 2800, 3300, 3700, 3900, 4300, 5000, 6400] : [2600, 3900, 4400, 6200];
      let now = 0;
      for (const at of moments) {
        await page.clock.runFor(at - now); now = at;
        await shot(page, `hatch-${tier}-${String(at).padStart(4, "0")}`);
      }
      const done = await page.evaluate(() => window.__hatchDone);
      check(done, `hatch ${tier}: play() resolved by ${now} ms`);
      const beats = (await state(page)).log.filter(entry => entry.startsWith("beat:"));
      check(beats.join() === "beat:wobble,beat:wobble,beat:wobble,beat:crack,beat:merge,beat:reveal", `hatch ${tier}: beats ${beats.join(" ")}`);
      await context.close();
    }
    // Skip jumps to the final frame and resolves.
    const { page, context } = await open("babies=0&tier=mutant");
    await page.evaluate(() => { window.__hatchDone = false; window.__harness.hatch().then(() => { window.__hatchDone = true; }); });
    await page.clock.runFor(900);
    await page.evaluate(() => window.__harness.skip());
    await page.clock.runFor(100);
    check(await page.evaluate(() => window.__hatchDone), "hatch skip(): play() resolved");
    await shot(page, "hatch-skip");
    await context.close();
  }

  if (run("small")) {
    const { page, context } = await open("babies=2&w=360&tier=prismatic", { width: 360, height: 240, scale: 3, touch: true });
    await page.evaluate(() => { void window.__harness.hatch(); });
    await page.clock.runFor(2700);
    await shot(page, "hatch-360-merge");
    await page.clock.runFor(2400);
    await shot(page, "hatch-360-final");
    await context.close();
  }

  if (run("courtship")) {
    const { page, context } = await open("babies=3");
    await page.evaluate(() => { window.__courtDone = false; window.__harness.courtship(7).then(() => { window.__courtDone = true; }); });
    let now = 0;
    for (const at of [250, 700, 1100, 1500, 1900]) { await page.clock.runFor(at - now); now = at; await shot(page, `courtship-${String(at).padStart(4, "0")}`); }
    await page.clock.runFor(700);
    const done = await page.evaluate(() => window.__courtDone);
    const entry = (await state(page)).log.find(item => item.startsWith("courtship:done"));
    check(done, `courtship resolved (${entry})`);
    check(entry && Number(entry.split(":")[2]) <= 2500, "courtship takes at most 2.5 s");
    await context.close();
  }

  if (run("release")) {
    const { page, context } = await open("babies=3");
    await page.evaluate(() => { window.__relDone = false; window.__harness.release().then(() => { window.__relDone = true; }); });
    let now = 0;
    for (const at of [600, 1400, 2100, 2700]) { await page.clock.runFor(at - now); now = at; await shot(page, `release-${String(at).padStart(4, "0")}`); }
    await page.clock.runFor(2000);
    check(await page.evaluate(() => window.__relDone), `release resolved (${(await state(page)).log.find(item => item.startsWith("release:done"))})`);
    await page.evaluate(() => window.__harness.celebrate());
    await page.clock.runFor(250);
    await shot(page, "celebrate");
    const added = await page.evaluate(() => window.__harness.addBaby("prismatic"));
    await page.clock.runFor(180);
    await shot(page, "pop-in");
    check(typeof added === "string", "addBaby pops a new baby in");
    await context.close();
  }

  if (run("reduced")) {
    const { page, context } = await open("babies=3&reduced=1");
    const started = await page.evaluate(() => { window.__courtDone = false; window.__harness.courtship(3).then(() => { window.__courtDone = true; }); return true; });
    await page.clock.runFor(1100);
    check(started && await page.evaluate(() => window.__courtDone), "reduced motion courtship resolves within 1.1 s");
    await page.evaluate(() => { window.__hatchDone = false; window.__harness.hatch("spotted").then(() => { window.__hatchDone = true; }); });
    await page.clock.runFor(200);
    await shot(page, "reduced-hatch-fade");
    await page.clock.runFor(500);
    check(await page.evaluate(() => window.__hatchDone), "reduced motion hatch resolves within 0.7 s");
    await shot(page, "reduced-hatch-final");
    await context.close();
  }

  if (wanted.has("perf")) {
    // Real clock: frame pacing with a big brood, particles and a courtship running.
    const context = await browser.newContext({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on("pageerror", error => problems.push(`[perf] pageerror: ${error.message}`));
    await page.addInitScript(() => {
      // Time every animation frame callback (the scene's update + render).
      const raf = window.requestAnimationFrame.bind(window);
      window.__frameCost = [];
      window.requestAnimationFrame = callback => raf(now => { const start = performance.now(); callback(now); window.__frameCost.push(performance.now() - start); });
    });
    await page.goto(`${server.url}?clean=1&babies=12&eggs=3`);
    await page.waitForFunction(() => !!window.__harness);
    const stats = await page.evaluate(async () => {
      const h = window.__harness;
      void h.courtship(4);
      setTimeout(() => h.celebrate(h.player.key), 600);
      const deltas = [];
      let last = performance.now();
      await new Promise(done => {
        const tick = now => { deltas.push(now - last); last = now; if (deltas.length < 240) requestAnimationFrame(tick); else done(); };
        requestAnimationFrame(tick);
      });
      const busy = [];
      const original = CanvasRenderingContext2D.prototype.drawImage;
      deltas.sort((a, b) => a - b);
      return { median: deltas[120], p95: deltas[228], max: deltas[239], busy: busy.length, original: !!original };
    });
    console.log(`perf: median ${stats.median.toFixed(1)} ms, p95 ${stats.p95.toFixed(1)} ms, max ${stats.max.toFixed(1)} ms per frame`);
    const cost = await page.evaluate(() => { const list = window.__frameCost.slice(30).sort((a, b) => a - b); return { median: list[list.length >> 1], p95: list[Math.floor(list.length * 0.95)], max: list[list.length - 1] }; });
    console.log(`perf: script cost per frame median ${cost.median.toFixed(2)} ms, p95 ${cost.p95.toFixed(2)} ms, max ${cost.max.toFixed(2)} ms`);
    check(cost.p95 < 6, "scene update + render p95 under 6 ms");
    await page.evaluate(() => { window.__frameCost.length = 0; void window.__harness.hatch("prismatic"); });
    await page.waitForTimeout(5200);
    const hatchCost = await page.evaluate(() => { const list = window.__frameCost.slice(5).sort((a, b) => a - b); return { median: list[list.length >> 1], p95: list[Math.floor(list.length * 0.95)], max: list[list.length - 1] }; });
    console.log(`perf: hatch overlay + paused world per frame median ${hatchCost.median.toFixed(2)} ms, p95 ${hatchCost.p95.toFixed(2)} ms, max ${hatchCost.max.toFixed(2)} ms`);
    check(hatchCost.p95 < 8, "hatch frame p95 under 8 ms");
    check(stats.p95 < 20, "frame pacing p95 under 20 ms (60 fps) with 12 babies + courtship");
    await context.close();
  }

  if (run("checks")) {
    const { page, context } = await open("babies=2");
    // Keyboard movement.
    const start = await state(page);
    await page.keyboard.down("KeyD"); await page.clock.runFor(500); await page.keyboard.up("KeyD");
    await page.clock.runFor(200);
    const moved = await state(page);
    check(moved.x > start.x + 60 && Math.abs(moved.y - start.y) < 2, `D moves right (${start.x} -> ${moved.x})`);
    await page.keyboard.down("ArrowUp"); await page.clock.runFor(300); await page.keyboard.up("ArrowUp");
    await page.clock.runFor(200);
    const up = await state(page);
    check(up.y < moved.y - 30, `ArrowUp moves up (${moved.y} -> ${up.y})`);
    // Blur stops held keys.
    await page.keyboard.down("ArrowLeft"); await page.clock.runFor(100);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    const beforeBlur = await state(page);
    await page.clock.runFor(400);
    const afterBlur = await state(page);
    await page.keyboard.up("ArrowLeft");
    check(Math.abs(afterBlur.x - beforeBlur.x) < 8, `window blur stops held movement (${beforeBlur.x} -> ${afterBlur.x})`);
    // Click to walk (logical 700, 460 at 1:1 CSS scale).
    await page.mouse.click(700, 460);
    await page.clock.runFor(2500);
    const walked = await state(page);
    check(Math.hypot(walked.x - 700, walked.y - 460) < 14, `click-to-walk reaches target (${walked.x}, ${walked.y})`);
    // Click-to-walk around an obstacle (behind the pouf) and to a blocked prop spot.
    await page.mouse.click(300, 560);
    await page.clock.runFor(3000);
    const blocks = await state(page);
    check(Math.hypot(blocks.x - 300, blocks.y - 560) < 40, `click near toy blocks walks to the nearest free spot (${blocks.x}, ${blocks.y})`);
    // Walk to the incubator and press E.
    await page.mouse.click(480, 262);
    await page.clock.runFor(2500);
    const atIncubator = await state(page);
    check(atIncubator.near === "incubator", `near incubator (near=${atIncubator.near})`);
    await shot(page, "prompt-incubator");
    await page.keyboard.press("KeyE");
    await page.clock.runFor(50);
    check((await state(page)).log.includes("activate:incubator"), "E activates the incubator");
    // Clicking a far station walks there and activates it.
    await page.mouse.click(100, 250);
    await page.clock.runFor(2500);
    const logAfter = (await state(page)).log;
    check(logAfter.includes("activate:matchmaker"), `clicking the matchmaker walks there and activates (${logAfter.slice(-3).join(" ")})`);
    await shot(page, "prompt-matchmaker");
    // Buttons keep Space/Enter.
    const buttonKeys = await page.evaluate(() => {
      const button = document.createElement("button"); button.textContent = "UI"; document.body.append(button); button.focus();
      let clicked = 0; button.addEventListener("click", () => clicked++);
      return clicked;
    });
    await page.keyboard.press("Enter");
    const clickedAfter = await page.evaluate(() => document.activeElement?.tagName);
    check(buttonKeys === 0 && clickedAfter === "BUTTON", "keys on a focused button are left to the button");
    // A focused HUD button still lets WASD / arrows walk the Friend.
    const beforeButtonWalk = await state(page);
    await page.keyboard.down("ArrowRight"); await page.clock.runFor(300); await page.keyboard.up("ArrowRight");
    await page.clock.runFor(100);
    const afterButtonWalk = await state(page);
    check(afterButtonWalk.x > beforeButtonWalk.x + 30, `arrows walk even while a HUD button has focus (${beforeButtonWalk.x} -> ${afterButtonWalk.x})`);
    // Text fields own every key.
    await page.evaluate(() => { const input = document.createElement("input"); input.id = "typing"; document.body.append(input); input.focus(); });
    await page.clock.runFor(500);
    const beforeTyping = await state(page);
    await page.keyboard.down("KeyD"); await page.clock.runFor(300); await page.keyboard.up("KeyD");
    const afterTyping = await state(page);
    check(afterTyping.x === beforeTyping.x, `typing into a text field does not move the Friend (${beforeTyping.x} -> ${afterTyping.x})`);
    await page.evaluate(() => { document.querySelector("body > button")?.remove(); document.getElementById("typing")?.remove(); scrollTo(0, 0); });
    // Pause ignores input.
    await page.evaluate(() => window.__harness.pause(true));
    const pausedAt = await state(page);
    await page.keyboard.down("ArrowDown"); await page.clock.runFor(400); await page.keyboard.up("ArrowDown");
    await page.mouse.click(500, 500); await page.clock.runFor(400);
    const pausedAfter = await state(page);
    check(pausedAt.x === pausedAfter.x && pausedAt.y === pausedAfter.y, "paused scene ignores keys and clicks");
    // Paused: a still frame (babies and animations freeze, new babies wait to pop in).
    const frozenBefore = await page.evaluate(() => document.getElementById("world").dataset.babies);
    const pixelsBefore = await page.evaluate(() => document.getElementById("world").toDataURL().length);
    await page.evaluate(() => window.__harness.addBaby("spotted"));
    await page.clock.runFor(800);
    const frozenAfter = await page.evaluate(() => document.getElementById("world").dataset.babies);
    const pixelsAfter = await page.evaluate(() => document.getElementById("world").toDataURL().length);
    check(frozenAfter.startsWith(frozenBefore) && pixelsBefore === pixelsAfter, "paused world renders a still frame (new baby waits to pop in)");
    await page.evaluate(() => window.__harness.pause(false));
    // Tapping a baby reports its key (and does not walk there).
    await page.mouse.click(480, 420);
    await page.clock.runFor(2200);
    const [bx, by] = (await page.evaluate(() => document.getElementById("world").dataset.babies)).split(" ")[0].split(",").map(Number);
    await page.evaluate(() => { window.__harness.log.length = 0; });
    const beforeTap = await state(page);
    await page.mouse.click(bx, by - 14);
    await page.clock.runFor(300);
    const tapped = await state(page);
    check(tapped.log.some(entry => entry.startsWith("creature:baby:")) && Math.hypot(tapped.x - beforeTap.x, tapped.y - beforeTap.y) < 2, `tapping a baby calls onCreatureActivate (${tapped.log.join(" ")})`);
    // Resize: pointer mapping follows the CSS scale, including a letterboxed (non 3:2) box.
    await page.setViewportSize({ width: 480, height: 320 });
    await page.evaluate(() => { document.getElementById("frame").style.width = "480px"; });
    // Let a real rendering update deliver the resize (the fake clock alone does not), then render.
    await page.waitForTimeout(120);
    await page.clock.runFor(100);
    // 480 px is compact: the camera zooms in, and clicks map through it.
    const here = await state(page);
    const goal = { x: Math.round(here.x + (here.x < 480 ? 170 : -170)), y: Math.round(here.y + (here.y < 400 ? 60 : -60)) };
    const click = await toClient(page, goal.x, goal.y);
    await page.mouse.click(click.x, click.y);
    await page.clock.runFor(3000);
    const resized = await state(page);
    check(Math.hypot(resized.x - goal.x, resized.y - goal.y) < 14, `after resize to 480 px, a click through the zoomed camera reaches (${goal.x}, ${goal.y}) -> (${resized.x}, ${resized.y})`);
    const backing = await page.evaluate(() => { const c = document.getElementById("world"); const [, , w, h, zoom] = c.dataset.view.split(",").map(Number); return { size: `${c.width}x${c.height}`, w, h, zoom }; });
    check(backing.zoom > 1 && backing.size === `${Math.round(backing.w)}x${Math.round(backing.h)}`, `backing store covers only the visible region (${backing.size} for ${backing.w} x ${backing.h} logical, zoom ${backing.zoom}, dpr 1)`);
    await page.setViewportSize({ width: 960, height: 640 });
    await page.evaluate(() => { const frame = document.getElementById("frame"); frame.style.width = "960px"; frame.style.aspectRatio = "16 / 9"; });
    await page.waitForTimeout(120);
    await page.clock.runFor(100);
    // 960 x 540 box: content is 810 x 540, centred with 75 px bars left and right.
    await page.mouse.click(75 + 480 * 810 / 960, 300 * 540 / 640);
    await page.clock.runFor(3000);
    const boxed = await state(page);
    check(Math.hypot(boxed.x - 480, boxed.y - 300) < 14, `letterboxed canvas maps clicks correctly (${boxed.x}, ${boxed.y})`);
    await page.evaluate(() => { const frame = document.getElementById("frame"); frame.style.aspectRatio = ""; });
    // Destroy removes listeners and stops the loop.
    await page.evaluate(() => window.__harness.destroy());
    const beforeDestroy = await state(page);
    await page.keyboard.down("ArrowRight"); await page.clock.runFor(300); await page.keyboard.up("ArrowRight");
    const afterDestroy = await state(page);
    check(beforeDestroy.x === afterDestroy.x, "destroy() stops movement and input");
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (problems.length) { console.log("\nConsole problems:"); for (const problem of problems) console.log("  " + problem); }
else console.log("\nNo console errors or warnings.");
console.log(failures ? `${failures} check(s) failed` : "All checks passed");
process.exitCode = failures ? 1 : 0;
