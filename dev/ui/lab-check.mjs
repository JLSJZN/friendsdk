// Dev-only: Gene Lab hit test. Presses the first and the last CSS pixel of every row on both rails and all three portraits
// (desktop and a phone frame) and checks the lab names that row, so a rail's padding or a portrait's border and halo row
// never shifts a press onto the next row. Usage: node dev/ui/lab-check.mjs
import { chromium } from "playwright";
import { startServer } from "./serve.mjs";

const server = await startServer();
const browser = await chromium.launch();
const problems = [];
const SURFACES = [".rb-lab-rail-a", ".rb-lab-rail-b", ".rb-lab-slot-a", ".rb-lab-slot-baby", ".rb-lab-slot-b"];

for (const [width, height, ratio] of [[960, 640, 2], [390, 651, 3], [360, 480, 2]]) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: ratio });
  page.on("pageerror", error => problems.push(`${width}: ${error.message}`));
  await page.goto(`${server.url}?s=genelab-locked&child=1`);
  await page.waitForSelector(".rb-lab-bench:not(.rb-lab-measuring)");
  await page.waitForFunction(() => !document.querySelector(".rb-lab-possible")?.textContent?.startsWith("..."));
  await page.waitForTimeout(900); // the panel's open animation scales it
  let checked = 0;
  for (const surface of SURFACES) {
    await page.locator(surface).scrollIntoViewIfNeeded();
    // Row edges from the elements that draw them: the rail's cells, the portrait's row overlay.
    const rows = await page.locator(`${surface} :is(.rb-lab-cell, .rb-lab-row)`).evaluateAll(cells => cells.map(cell => {
      const box = cell.getBoundingClientRect();
      return { x: box.left + box.width / 2, top: box.top, bottom: box.bottom };
    }));
    for (const [row, box] of rows.entries()) for (const y of [box.top + 0.25, box.bottom - 0.25]) {
      await page.mouse.move(box.x, y);
      await page.mouse.down();
      const caption = await page.locator(".rb-lab-caption").innerText();
      await page.mouse.up();
      checked++;
      if (!caption.startsWith(`Row ${row + 1} `) && !caption.startsWith(`Row ${row + 1}:`))
        problems.push(`${width}x${height} ${surface} row ${row + 1} at y ${(y - box.top).toFixed(2)} of ${(box.bottom - box.top).toFixed(2)}: "${caption}"`);
    }
  }
  console.log(`${width}x${height}: ${checked} presses on ${SURFACES.length} surfaces`);
  await page.close();
}
await browser.close();
await server.close();
console.log(problems.length ? `\n${problems.length} problem(s):\n${problems.slice(0, 20).join("\n")}` : "\nNo problems found.");
process.exitCode = problems.length ? 1 : 0;
