// Dev-only: screenshots and behaviour checks for the Moon Slingshot flight (headless Chromium, fake clock).
// Usage: node dev/launch/shoot.mjs [pond haystack rooftop cloud orbit moon] [phone] [variety] [skip] [reduced] [idle] [perf]   (default: all)
// Env: AT="100,500,900" overrides the moments of the zone shots, TIER=prismatic, HAT=crown, PULL=0.3.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./serve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, "shots");
await mkdir(shots, { recursive: true });
const ZONES = ["pond", "haystack", "rooftop", "cloud", "orbit", "moon"];
const wanted = new Set(process.argv.slice(2));
const run = name => wanted.size === 0 || wanted.has(name);
const zones = ZONES.filter(zone => wanted.has(zone));
const allZones = zones.length ? zones : ZONES;

const MOMENTS = {
  pond: [16, 200, 520, 760, 950, 1050, 1150, 1300, 1500, 1750, 2000, 2400],
  haystack: [250, 600, 1000, 1350, 1480, 1540, 1650, 1900, 2400, 3000],
  rooftop: [300, 900, 1500, 1930, 1990, 2120, 2450, 2700, 2900, 3080, 3300, 3800],
  cloud: [400, 1000, 1500, 2100, 2500, 2600, 2850, 3200, 3700, 4400],
  orbit: [300, 800, 1200, 1440, 1600, 1900, 2200, 2450, 2700, 3000, 3600, 5000],
  moon: [1600, 2200, 2600, 3000, 3400, 3800, 4100, 4320, 4600, 4820, 5100, 5600],
};
const ENDS = { pond: 2250, haystack: 2900, rooftop: 3700, cloud: 4300, orbit: 4900, moon: 5500 };

const server = await startServer({ port: Number(process.env.PORT ?? 0) });
const browser = await chromium.launch();
const problems = [];
let failures = 0;
const check = (ok, message) => { console.log(`${ok ? "PASS" : "FAIL"} ${message}`); if (!ok) failures++; };
const extra = [process.env.TIER && `tier=${process.env.TIER}`, process.env.HAT && `hat=${process.env.HAT}`, process.env.PULL && `pull=${process.env.PULL}`].filter(Boolean).join("&");

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
const start = (page, zone, options = {}) => page.evaluate(([zone, options]) => {
  window.__done = null;
  window.__launch.play(zone, options).then(ms => { window.__done = ms; });
}, [zone, options]);
const beats = page => page.evaluate(() => window.__launch.log.filter(entry => entry.startsWith("beat:")).map(entry => entry.split(":").slice(1).join(":")));

try {
  for (const zone of allZones) {
    if (!run(zone) && wanted.size && !wanted.has("zones")) continue;
    const { page, context } = await open(`zone=${zone}`);
    await start(page, zone);
    const moments = process.env.AT ? process.env.AT.split(",").map(Number) : MOMENTS[zone];
    let now = 0;
    for (const at of moments) {
      if (at > now) { await page.clock.runFor(at - now); now = at; }
      await shot(page, `${zone}-${String(at).padStart(4, "0")}`);
    }
    if (now < ENDS[zone] + 50) { await page.clock.runFor(ENDS[zone] + 50 - now); now = ENDS[zone] + 50; }
    const done = await page.evaluate(() => window.__done);
    check(done !== null && done >= ENDS[zone] - 20 && done <= ENDS[zone] + 60, `${zone}: play() resolved at ${done} ms (end ${ENDS[zone]})`);
    const list = await beats(page);
    check(list.map(b => b.split(":")[0]).join() === "launch,apex,land", `${zone}: beats ${list.join(" ")}`);
    await context.close();
  }

  if (run("phone")) {
    // The game's phone frame: 390 x 260 CSS px at DPR 3, with the UI's reserved bands shown.
    const phoneMoments = { pond: [900, 1150, 1750], haystack: [1000, 1650, 2400], rooftop: [1500, 2450, 3300], cloud: [1500, 2850, 4400], orbit: [1200, 2200, 3600], moon: [3000, 4320, 5100] };
    for (const zone of allZones) {
      const { page, context } = await open(`zone=${zone}&w=390&safe=1`, { width: 390, height: 260, scale: 3 });
      await start(page, zone);
      let now = 0;
      for (const at of phoneMoments[zone]) { await page.clock.runFor(at - now); now = at; await shot(page, `phone-${zone}-${String(at).padStart(4, "0")}`); }
      await context.close();
    }
  }

  if (run("variety")) {
    // Other babies, every tier, hats: the gags must read whatever the sprite.
    const cases = [
      ["haystack", 1760, 7, "prismatic", "crown"], ["haystack", 1760, 13, "mutant", ""], ["haystack", 1760, 21, "common", "party-hat"],
      ["pond", 1700, 7, "prismatic", "crown"], ["rooftop", 3300, 13, "mutant", "top-hat"], ["cloud", 4400, 21, "spotted", "halo"],
      ["moon", 5100, 7, "prismatic", "crown"], ["orbit", 3200, 30, "mutant", "bow"],
    ];
    for (const [zone, at, baby, tier, hat] of cases) {
      const { page, context } = await open(`zone=${zone}&baby=${baby}&tier=${tier}${hat ? `&hat=${hat}` : ""}`);
      await start(page, zone);
      await page.clock.runFor(at);
      await shot(page, `variety-${zone}-${baby}-${tier}`);
      await context.close();
    }
  }

  if (run("skip")) {
    for (const zone of allZones) {
      const { page, context } = await open(`zone=${zone}`);
      await start(page, zone);
      await page.clock.runFor(400);
      await page.evaluate(() => window.__launch.skip());
      await page.clock.runFor(60);
      const done = await page.evaluate(() => window.__done);
      check(done !== null && done < 600, `${zone} skip(): play() resolved right away (${done} ms)`);
      const list = (await beats(page)).map(b => b.split(":")[0]);
      check(list.join() === "launch,land", `${zone} skip(): beats ${list.join(" ")} (land fired once, apex marked)`);
      await shot(page, `skip-${zone}`);
      await page.clock.runFor(2000);
      const after = (await beats(page)).map(b => b.split(":")[0]);
      check(after.join() === "launch,land", `${zone} skip(): no late beats (${after.join(" ")})`);
      await context.close();
    }
    // Skip before play(): lands, resolves play() afterwards too.
    const { page, context } = await open("zone=cloud");
    const early = await page.evaluate(async () => {
      const h = window.__launch;
      const run = h.play("cloud");
      h.skip();
      const again = await Promise.race([run.then(() => "resolved"), new Promise(done => setTimeout(() => done("pending"), 200))]);
      return again;
    });
    await page.clock.runFor(300);
    check(early === "resolved" || (await page.evaluate(() => window.__launch.log.some(e => e.startsWith("done")))), `skip right after play(): resolves (${early})`);
    await context.close();
  }

  if (run("reduced")) {
    for (const zone of allZones) {
      const { page, context } = await open(`zone=${zone}&reduced=1`);
      await start(page, zone, { reduced: true });
      await page.clock.runFor(200);
      await shot(page, `reduced-${zone}-fade`);
      await page.clock.runFor(450);
      const done = await page.evaluate(() => window.__done);
      check(done !== null && done <= 620, `${zone} reduced: resolves after the fade (${done} ms)`);
      const list = (await beats(page)).map(b => b.split(":")[0]);
      check(list.join() === "launch,land", `${zone} reduced: beats ${list.join(" ")}`);
      await shot(page, `reduced-${zone}`);
      await context.close();
    }
  }

  if (run("idle")) {
    // The landed frame idles gently for 2 s after the end, lets its last particles settle, then holds still.
    const pixels = page => page.evaluate(() => document.getElementById("overlay").toDataURL());
    for (const zone of allZones) {
      const { page, context } = await open(`zone=${zone}`);
      await start(page, zone);
      await page.clock.runFor(ENDS[zone] + 300);
      const early = await pixels(page);
      await page.clock.runFor(400);
      const moving = early !== await pixels(page);
      await page.clock.runFor(4000);
      const late = await pixels(page);
      await page.clock.runFor(1000);
      check(late === await pixels(page), `${zone} idle: the frame holds still after the idle window${moving ? " (and still moved right after the end)" : ""}`);
      await context.close();
    }
  }

  if (run("perf")) {
    // Real time (no fake clock): script cost per frame of the whole flight, prismatic baby.
    for (const zone of ["rooftop", "moon"]) {
      const context = await browser.newContext({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      page.on("pageerror", error => problems.push(`[perf] pageerror: ${error.message}`));
      await page.addInitScript(() => {
        const raf = window.requestAnimationFrame.bind(window);
        window.__frameCost = [];
        window.requestAnimationFrame = callback => raf(now => { const s = performance.now(); callback(now); window.__frameCost.push(performance.now() - s); });
      });
      await page.goto(`${server.url}?clean=1&tier=prismatic&zone=${zone}`);
      await page.waitForFunction(() => !!window.__launch);
      // Creation cost: the first launch paints the shared world art, later ones reuse it.
      const setup = await page.evaluate(zone => { const times = []; for (let i = 0; i < 2; i++) { const s = performance.now(); void window.__launch.play(zone); times.push(performance.now() - s); } return times; }, zone);
      console.log(`perf ${zone}: createLaunchSequence first ${setup[0].toFixed(1)} ms (paints the world art), then ${setup[1].toFixed(1)} ms`);
      check(setup[0] < 120 && setup[1] < 30, `perf ${zone}: setup under 120 ms first, 30 ms cached`);
      await page.evaluate(() => { window.__frameCost.length = 0; });
      const ms = await page.evaluate(zone => window.__launch.play(zone), zone);
      const cost = await page.evaluate(() => { const list = window.__frameCost.slice(3).sort((a, b) => a - b); return { n: list.length, median: list[list.length >> 1], p95: list[Math.floor(list.length * 0.95)], max: list[list.length - 1] }; });
      console.log(`perf ${zone}: ${cost.n} frames in ${ms} ms, script per frame median ${cost.median.toFixed(2)} ms, p95 ${cost.p95.toFixed(2)} ms, max ${cost.max.toFixed(2)} ms`);
      check(cost.p95 < 8, `perf ${zone}: frame p95 under 8 ms`);
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
