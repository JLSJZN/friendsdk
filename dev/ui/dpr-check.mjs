// Dev-only: checks sprite canvases map 1:1 to device pixels at fractional ratios and the DNA trio stays row aligned.
import { chromium } from "playwright";
import { startServer } from "./serve.mjs";
const server = await startServer();
const browser = await chromium.launch();
let failures = 0;
for (const ratio of [1, 1.5, 2, 2.625, 3]) {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: ratio });
  await page.goto(`${server.url}?s=reveal-mutant&child=1`);
  await page.waitForTimeout(900);
  const result = await page.evaluate(() => {
    const ratio = devicePixelRatio;
    const thumbs = [...document.querySelectorAll("canvas.rb-thumb, canvas.rb-trio-canvas")].map(canvas => {
      const r = canvas.getBoundingClientRect();
      return { ok: Math.abs(r.width * ratio - canvas.width) < 0.6, css: r.width, device: r.width * ratio, bitmap: canvas.width };
    });
    // DNA trio: the first sprite row of every portrait and both links sits on one y, and the grids are 16 rows tall.
    const px = parseFloat(getComputedStyle(document.querySelector(".rb-trio")).getPropertyValue("--rb-px"));
    const tops = [...document.querySelectorAll(".rb-trio-slot canvas")].map(el => el.getBoundingClientRect().top + px)
      .concat([...document.querySelectorAll(".rb-trio-link")].map(el => el.getBoundingClientRect().top + parseFloat(getComputedStyle(el).paddingTop)));
    const heights = [...document.querySelectorAll(".rb-trio-link, .rb-trio-rows")].map(el => el.getBoundingClientRect().height - parseFloat(getComputedStyle(el).paddingTop) - 16 * px);
    return { exact: thumbs.every(t => t.ok), thumbs: thumbs.map(t => `${t.bitmap}->${t.device.toFixed(2)}`).join(" "),
      rowSpread: +(Math.max(...tops) - Math.min(...tops)).toFixed(3), heightError: +Math.max(...heights.map(Math.abs)).toFixed(3) };
  });
  const ok = result.exact && result.rowSpread < 0.5 && result.heightError < 0.5;
  if (!ok) failures++;
  console.log(`dpr ${ratio}: ${ok ? "ok" : "FAIL"} ${JSON.stringify(result)}`);
  await page.close();
}
await browser.close(); await server.close();
process.exitCode = failures ? 1 : 0;
