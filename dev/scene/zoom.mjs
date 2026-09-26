// Dev-only: zoomed crops of the harness. Usage: node dev/scene/zoom.mjs "<query>" x,y,w,h[,ms] ... (logical px)
import { chromium } from "playwright";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./serve.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const [query = "babies=4", ...regions] = process.argv.slice(2);
const server = await startServer();
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 960, height: 640 }, deviceScaleFactor: Number(process.env.DSF ?? 2) })).newPage();
page.on("pageerror", error => console.log("pageerror", error.message));
await page.clock.install({ time: 0 });
await page.goto(`${server.url}?clean=1&${query}`);
await page.waitForFunction(() => !!window.__harness);
await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 250);
if (process.env.SETUP) await page.evaluate(`void (${process.env.SETUP})`);
let now = 0, index = 0;
for (const region of regions.length ? regions : ["0,0,960,640"]) {
  const [x, y, width, height, at = 1500] = region.split(",").map(Number);
  await page.clock.runFor(Math.max(1, at - now)); now = Math.max(now, at);
  await page.screenshot({ path: join(here, "shots", `zoom-${index++}.png`), clip: { x, y, width, height } });
}
await browser.close(); await server.close();
