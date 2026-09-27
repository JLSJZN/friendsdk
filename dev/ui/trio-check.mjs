// Dev-only: DNA trio interaction check. Hovers a baby row and a parent row, taps on a phone frame, walks rows
// with the keyboard, and verifies the three portraits share one row grid. Usage: node dev/ui/trio-check.mjs [outDir]
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./serve.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? path.join(here, "shots");
const server = await startServer();
const browser = await chromium.launch();
const problems = [];

async function open(width, height, scenario, touch = false) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: touch });
  page.on("pageerror", error => problems.push(`${scenario}: ${error.message}`));
  await page.goto(`${server.url}?s=${scenario}&child=1`);
  await page.waitForSelector(".rb-trio:not(.rb-trio-measuring)");
  await page.waitForTimeout(1200);
  return page;
}
const caption = page => page.locator(".rb-trio-caption").innerText();
const rowPoint = async (page, side, row) => {
  const box = await page.locator(`.rb-trio-slot-${side}`).boundingBox();
  const border = await page.locator(`.rb-trio-slot-${side}`).evaluate(el => el.clientTop);
  const px = await page.locator(`.rb-trio-slot-${side} canvas`).evaluate(el => el.getBoundingClientRect().height / 18);
  return { x: box.x + box.width / 2, y: box.y + border + px * (row + 1.5) };
};

{
  const page = await open(960, 640, "reveal-mutant");
  // Shared grid: every portrait and both links start their first row at the same y.
  const tops = await page.evaluate(() => [...document.querySelectorAll(".rb-trio-slot canvas, .rb-trio-link")].map(el => {
    const r = el.getBoundingClientRect(), style = getComputedStyle(el);
    const px = parseFloat(getComputedStyle(document.querySelector(".rb-trio")).getPropertyValue("--rb-px"));
    return el.tagName === "CANVAS" ? r.top + px : r.top + parseFloat(style.paddingTop);
  }));
  const spread = Math.max(...tops) - Math.min(...tops);
  console.log(`row 1 top across portraits and links: spread ${spread.toFixed(2)}px`);
  if (spread > 0.6) problems.push(`rows misaligned by ${spread}px`);
  const point = await rowPoint(page, "baby", 5);
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(150);
  console.log(`hover baby row 6 -> ${await caption(page)}`);
  await page.screenshot({ path: path.join(outDir, "trio-hover-baby-960.png") });
  const pa = await rowPoint(page, "a", 10);
  await page.mouse.move(pa.x, pa.y);
  await page.waitForTimeout(150);
  console.log(`hover parent A row 11 -> ${await caption(page)}`);
  await page.screenshot({ path: path.join(outDir, "trio-hover-a-960.png") });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(100);
  console.log(`mouse out -> ${await caption(page)}`);
  await page.locator(".rb-trio").focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(100);
  console.log(`keyboard ArrowDown x3, ArrowRight -> ${await caption(page)}`);
  await page.screenshot({ path: path.join(outDir, "trio-keyboard-960.png") });
  await page.close();
}
{
  const page = await open(390, 520, "reveal-spotted", true);
  const point = await rowPoint(page, "b", 12);
  await page.touchscreen.tap(point.x, point.y);
  await page.waitForTimeout(150);
  console.log(`tap parent B row 13 (390x520) -> ${await caption(page)}`);
  await page.screenshot({ path: path.join(outDir, "trio-tap-390p.png") });
  await page.close();
}
await browser.close();
await server.close();
console.log(problems.length ? `\n${problems.length} problem(s):\n${problems.join("\n")}` : "\nNo problems found.");
