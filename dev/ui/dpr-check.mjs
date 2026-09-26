// Dev-only: checks sprite canvases map 1:1 to device pixels at fractional ratios and the DNA rail stays row aligned.
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
    const thumbs = [...document.querySelectorAll("canvas.rb-thumb")].map(canvas => {
      const r = canvas.getBoundingClientRect();
      return { ok: Math.abs(r.width * ratio - canvas.width) < 0.6, css: r.width, device: r.width * ratio, bitmap: canvas.width };
    });
    const sprite = document.querySelector(".rb-card-sprite").getBoundingClientRect();
    const rail = document.querySelector(".rb-dna-rail").getBoundingClientRect();
    const px = sprite.height / 18;
    return { exact: thumbs.every(t => t.ok), thumbs: thumbs.map(t => `${t.bitmap}->${t.device.toFixed(2)}`).join(" "), railTopOffset: +(rail.top - (sprite.top + px)).toFixed(3), railHeight: +(rail.height - 16 * px).toFixed(3) };
  });
  const ok = result.exact && Math.abs(result.railTopOffset) < 0.5 && Math.abs(result.railHeight) < 0.5;
  if (!ok) failures++;
  console.log(`dpr ${ratio}: ${ok ? "ok" : "FAIL"} ${JSON.stringify(result)}`);
  await page.close();
}
await browser.close(); await server.close();
process.exitCode = failures ? 1 : 0;
