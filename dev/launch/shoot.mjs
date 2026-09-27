// Dev-only: screenshots and behaviour checks for the Moon Slingshot flight (headless Chromium, fake clock).
// Usage: node dev/launch/shoot.mjs [fizzle crash jump moon] [ready] [phone] [portrait] [variety] [skip] [reduced] [idle] [perf]   (default: all)
// Env: AT="100,500,900" overrides the moments of the ending shots, TIER=prismatic, HAT=crown.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./serve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, "shots");
await mkdir(shots, { recursive: true });
const ENDS = ["fizzle", "crash", "jump", "moon"];
const wanted = new Set(process.argv.slice(2));
const run = name => wanted.size === 0 || wanted.has(name);
const ends = ENDS.filter(end => wanted.has(end));
const allEnds = ends.length ? ends : ENDS;

// Moments (ms after ignition). Defaults: crash point x2.99 (decided at 4294 ms), jump at x4.40 (5791 ms), the Moon at 9000 ms.
const MOMENTS = {
  fizzle: [60, 300, 600, 900, 1100, 1250, 1500, 1800, 2300],
  crash: [900, 2750, 4300, 4450, 4750, 5100, 5450, 5700, 6200, 7000],
  jump: [1600, 2750, 4400, 5600, 5850, 6100, 6600, 7200, 7800, 8300],
  moon: [2750, 5450, 7500, 8900, 9060, 9400, 9900, 10300, 10700, 11200],
};
/** Latest moment each flight must have resolved by (ms after ignition). */
const LATEST = { fizzle: 2400, crash: 7000, jump: 8400, moon: 11300 };
const BEATS = { fizzle: "ignite,sputter,splash", crash: "ignite,pass,sputter,splash", jump: "ignite,pass,pass,jump,touchdown", moon: "ignite,pass,pass,touchdown,moon" };
const FINAL = { fizzle: "splash", crash: "splash", jump: "touchdown", moon: "moon" };

const server = await startServer({ port: Number(process.env.PORT ?? 0) });
const browser = await chromium.launch();
const problems = [];
let failures = 0;
const check = (ok, message) => { console.log(`${ok ? "PASS" : "FAIL"} ${message}`); if (!ok) failures++; };
const extra = [process.env.TIER && `tier=${process.env.TIER}`, process.env.HAT && `hat=${process.env.HAT}`].filter(Boolean).join("&");

async function open(query, { width = 960, height = 640, scale = 1 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  const page = await context.newPage();
  page.on("console", message => { if (message.type() === "error" || message.type() === "warning") problems.push(`[${query}] console.${message.type()}: ${message.text()}`); });
  page.on("pageerror", error => problems.push(`[${query}] pageerror: ${error.message}`));
  await page.clock.install({ time: 0 });
  await page.goto(`${server.url}?clean=1&${extra}&${query}`);
  await page.waitForFunction(() => !!window.__launch);
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 250);
  await page.clock.runFor(100);
  return { page, context };
}
const shot = (page, name) => page.screenshot({ path: join(shots, `${name}.png`) });
const start = (page, end, options = {}) => page.evaluate(([end, options]) => {
  window.__done = null;
  window.__launch.play(end, options).then(ms => { window.__done = ms; });
}, [end, options]);
const beats = page => page.evaluate(() => window.__launch.log.filter(entry => entry.startsWith("beat:")).map(entry => entry.split(":")[1]));

try {
  for (const end of allEnds) {
    if (!run(end) && wanted.size && !wanted.has("ends")) continue;
    const { page, context } = await open(`end=${end}`);
    await start(page, end);
    const moments = process.env.AT ? process.env.AT.split(",").map(Number) : MOMENTS[end];
    let now = 0;
    for (const at of moments) {
      if (at > now) { await page.clock.runFor(at - now); now = at; }
      await shot(page, `${end}-${String(at).padStart(5, "0")}`);
    }
    if (now < LATEST[end]) { await page.clock.runFor(LATEST[end] - now); now = LATEST[end]; }
    const done = await page.evaluate(() => window.__done);
    check(done !== null && done <= LATEST[end], `${end}: the flight and its ending resolved at ${done} ms (by ${LATEST[end]})`);
    const list = await beats(page);
    check(list.join() === BEATS[end], `${end}: beats ${list.join(" ")}`);
    await context.close();
  }

  if (run("ready")) {
    for (const [name, query, size] of [["ready", "", {}], ["ready-phone", "w=390&safe=1", { width: 390, height: 260, scale: 3 }]]) {
      const { page, context } = await open(query, size);
      await page.evaluate(() => { window.__launch.ready(); });
      await page.clock.runFor(700);
      await shot(page, name);
      await context.close();
    }
  }

  if (run("phone")) {
    // The game's phone frame: 390 x 260 CSS px at DPR 3, with the UI's reserved bands shown.
    const phoneMoments = { fizzle: [300, 900, 1800], crash: [2750, 4450, 5700], jump: [4400, 6100, 7800], moon: [7500, 9400, 10700] };
    for (const end of allEnds) {
      const { page, context } = await open(`end=${end}&w=390&safe=1`, { width: 390, height: 260, scale: 3 });
      await start(page, end);
      let now = 0;
      for (const at of phoneMoments[end]) { await page.clock.runFor(at - now); now = at; await shot(page, `phone-${end}-${String(at).padStart(5, "0")}`); }
      await context.close();
    }
  }

  if (run("portrait")) {
    // Portrait phone frames (390 x 650 and 360 x 640 CSS px at DPR 3): the canvas fills the frame with a slice of the
    // scene (no letterbox), panned from the window and the rocket to the landmarks, the pond, the hay or the Moon.
    const portraitMoments = { fizzle: [300, 1100, 1800], crash: [2750, 4450, 5700], jump: [2750, 5850, 7800], moon: [8900, 9400, 10700] };
    for (const [width, height] of [[390, 650], [360, 640]]) {
      const size = { width, height, scale: 3 };
      {
        const { page, context } = await open(`w=${width}&h=${height}`, size);
        await page.evaluate(() => { window.__launch.ready(); });
        await page.clock.runFor(700);
        await shot(page, `portrait-${width}-ready`);
        const fill = await page.evaluate(() => { const c = document.getElementById("overlay"), r = c.getBoundingClientRect(); return { canvas: c.width / c.height, box: r.width / r.height }; });
        check(Math.abs(fill.canvas - fill.box) < 0.01, `portrait ${width} x ${height}: the flight fills the frame (canvas ${fill.canvas.toFixed(3)}, box ${fill.box.toFixed(3)})`);
        await context.close();
      }
      for (const end of allEnds) {
        const { page, context } = await open(`end=${end}&w=${width}&h=${height}`, size);
        await start(page, end);
        let now = 0;
        for (const at of portraitMoments[end]) { await page.clock.runFor(at - now); now = at; await shot(page, `portrait-${width}-${end}-${String(at).padStart(5, "0")}`); }
        if (now < LATEST[end]) { await page.clock.runFor(LATEST[end] - now); now = LATEST[end]; }
        const done = await page.evaluate(() => window.__done);
        check(done !== null && done <= LATEST[end], `portrait ${width} ${end}: the flight and its ending resolved at ${done} ms`);
        await context.close();
      }
    }
  }

  if (run("variety")) {
    // Other babies, every tier, hats: the rocket, the strap, the parachute and the gags must read whatever the sprite.
    const cases = [
      ["jump", 3400, 7, "prismatic", "crown"], ["jump", 7800, 13, "mutant", ""], ["jump", 7800, 21, "common", "party-hat"],
      ["fizzle", 1800, 7, "prismatic", "crown"], ["crash", 4450, 13, "mutant", "top-hat"], ["crash", 6200, 21, "spotted", "halo"],
      ["moon", 10700, 7, "prismatic", "crown"], ["moon", 5450, 30, "mutant", "bow"],
    ];
    for (const [end, at, baby, tier, hat] of cases) {
      const { page, context } = await open(`end=${end}&baby=${baby}&tier=${tier}${hat ? `&hat=${hat}` : ""}`);
      await start(page, end);
      await page.clock.runFor(at);
      await shot(page, `variety-${end}-${baby}-${tier}`);
      await context.close();
    }
  }

  if (run("skip")) {
    for (const end of allEnds) {
      const { page, context } = await open(`end=${end}`);
      await start(page, end);
      const decided = await page.evaluate(end => window.__launch.decidedAt(end, { fizzle: 95, crash: 299, jump: 440, moon: 1000 }[end]), end);
      await page.clock.runFor(decided + 250);
      await page.evaluate(() => window.__launch.skip());
      await page.clock.runFor(60);
      const done = await page.evaluate(() => window.__done);
      check(done !== null && done < decided + 400, `${end} skip(): the ending resolved right away (${done} ms, decided at ${decided})`);
      const list = await beats(page);
      check(list.filter(beat => beat === FINAL[end]).length === 1, `${end} skip(): beats ${list.join(" ")} (the landing beat once)`);
      await shot(page, `skip-${end}`);
      await page.clock.runFor(2000);
      const after = await beats(page);
      check(after.join() === list.join(), `${end} skip(): no late beats (${after.join(" ")})`);
      await context.close();
    }
  }

  if (run("reduced")) {
    for (const end of allEnds) {
      const { page, context } = await open(`end=${end}&reduced=1`);
      await start(page, end, { reduced: true });
      const decided = await page.evaluate(end => window.__launch.decidedAt(end, { fizzle: 95, crash: 299, jump: 440, moon: 1000 }[end]), end);
      await page.clock.runFor(Math.max(0, decided - 400));
      await shot(page, `reduced-${end}-flying`);
      await page.clock.runFor(600);
      await shot(page, `reduced-${end}-fade`);
      await page.clock.runFor(500);
      const done = await page.evaluate(() => window.__done);
      check(done !== null && done <= decided + 620, `${end} reduced: resolves after the fade (${done} ms, decided at ${decided})`);
      const list = await beats(page);
      check(list[0] === "ignite" && list.at(-1) === FINAL[end], `${end} reduced: beats ${list.join(" ")}`);
      await shot(page, `reduced-${end}`);
      await context.close();
    }
  }

  if (run("idle")) {
    // The final frame idles gently for 2 s after the ending, lets its last particles settle, then holds still.
    const pixels = page => page.evaluate(() => document.getElementById("overlay").toDataURL());
    for (const end of allEnds) {
      const { page, context } = await open(`end=${end}`);
      await start(page, end);
      await page.clock.runFor(LATEST[end] + 300);
      const early = await pixels(page);
      await page.clock.runFor(400);
      const moving = early !== await pixels(page);
      await page.clock.runFor(4000);
      const late = await pixels(page);
      await page.clock.runFor(1000);
      check(late === await pixels(page), `${end} idle: the frame holds still after the idle window${moving ? " (and still moved right after the end)" : ""}`);
      await context.close();
    }
  }

  if (run("perf")) {
    // Real time (no fake clock): script cost per frame of a whole flight, prismatic baby.
    for (const end of ["jump", "moon"]) {
      const context = await browser.newContext({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      page.on("pageerror", error => problems.push(`[perf] pageerror: ${error.message}`));
      await page.addInitScript(() => {
        const raf = window.requestAnimationFrame.bind(window);
        window.__frameCost = [];
        window.requestAnimationFrame = callback => raf(now => { const s = performance.now(); callback(now); window.__frameCost.push(performance.now() - s); });
      });
      await page.goto(`${server.url}?clean=1&tier=prismatic&end=${end}`);
      await page.waitForFunction(() => !!window.__launch);
      // Creation cost: the first flight paints the shared world art, later ones reuse it.
      const setup = await page.evaluate(() => { const times = []; for (let i = 0; i < 2; i++) { const s = performance.now(); window.__launch.ready(); times.push(performance.now() - s); } return times; });
      console.log(`perf ${end}: createLaunchSequence first ${setup[0].toFixed(1)} ms (paints the world art), then ${setup[1].toFixed(1)} ms`);
      check(setup[0] < 120 && setup[1] < 30, `perf ${end}: setup under 120 ms first, 30 ms cached`);
      await page.evaluate(() => { window.__frameCost.length = 0; });
      const ms = await page.evaluate(end => window.__launch.play(end), end);
      const cost = await page.evaluate(() => { const list = window.__frameCost.slice(3).sort((a, b) => a - b); return { n: list.length, median: list[list.length >> 1], p95: list[Math.floor(list.length * 0.95)], max: list[list.length - 1] }; });
      console.log(`perf ${end}: ${cost.n} frames in ${ms} ms, script per frame median ${cost.median.toFixed(2)} ms, p95 ${cost.p95.toFixed(2)} ms, max ${cost.max.toFixed(2)} ms`);
      check(cost.p95 < 8, `perf ${end}: frame p95 under 8 ms`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
for (const problem of problems) console.log(problem);
check(problems.length === 0, `no console errors or warnings (${problems.length})`);
console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exitCode = failures ? 1 : 0;
