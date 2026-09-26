// Dev-only: screenshots every harness scenario at 960 x 640, 390 x 260 and 360 x 240 (inside the real SDK frame chrome),
// fails on console errors, and runs keyboard checks. Usage: node dev/ui/shots.mjs [scenario-filter]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./serve.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "shots");
const filter = process.argv[2] ?? "";
const SCENARIOS = ["thumbs", "nursery", "nursery-prompt", "matchmaker", "matchmaker-buy", "matchmaker-broke", "matchmaker-busy",
  "matchmaker-brood", "matchmaker-first", "intro-1", "intro-2", "intro-3", "intro-4", "nursery-coach", "shop", "shop-wish", "eggs", "eggs-stocked", "eggs-broke", "hatching", "reveal-common", "reveal-spotted", "reveal-mutant", "reveal-prismatic", "reveal-f3", "brood", "brood-detail",
  "brood-empty", "brood-tabs", "brood-legacy", "brood-legacy-ghost", "brood-legacy-empty", "brood-legacy-detail", "friend-panel",
  "matchmaker-stock", "matchmaker-preferred", "settings", "loading", "error"];
// Page viewport = frame + its 1px border, so the SDK frame renders at exactly 960 x 640 / 390 x 260 / 360 x 240.
// 390 matches the phone run of tools/test-game.mjs (390 x 844 page, 390 x 260 frame).
// 390p is a portrait phone: host.css switches the frame to 3:4 (390 x 520).
const SIZES = [{ name: "960", width: 962, height: 642 }, { name: "390p", width: 392, height: 522 }, { name: "360p", width: 362, height: 482 }, { name: "390", width: 392, height: 262 }, { name: "360", width: 362, height: 242 }];

await mkdir(outDir, { recursive: true });
const server = await startServer();
const browser = await chromium.launch();
const problems = [];

async function open(size, scenario, extra = "") {
  const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2 });
  const logs = [];
  page.on("console", message => { if (message.type() === "error" || message.type() === "warning") logs.push(`${message.type()}: ${message.text()}`); });
  page.on("pageerror", error => logs.push(`pageerror: ${error.message}`));
  await page.goto(`${server.url}?s=${scenario}${extra}`);
  await page.waitForSelector("iframe");
  const frame = await (await page.$("iframe")).contentFrame();
  await frame.waitForSelector(".rb-root");
  await page.waitForTimeout(1300);
  return { page, frame, logs };
}

/** Elements that must stay clear of the runtime toolbar band (and inside the frame). */
async function checkLayout(page, frame, label) {
  const chrome = await page.evaluate(() => {
    const frameBox = document.querySelector(".rf-game-frame").getBoundingClientRect();
    const iframe = document.querySelector("iframe").getBoundingClientRect();
    const bars = [...document.querySelectorAll(".rf-frame-toolbar > *")].map(el => el.getBoundingClientRect());
    return {
      offset: { x: iframe.left, y: iframe.top }, width: frameBox.width,
      band: { top: Math.min(...bars.map(bar => bar.top)) - iframe.top, right: Math.max(...bars.map(bar => bar.right)) - iframe.left },
      menuLeft: frameBox.right - (frameBox.width <= 520 ? 42 : 70) - iframe.left,
    };
  });
  const issues = await frame.evaluate(chrome => {
    const out = [];
    const view = { width: innerWidth, height: innerHeight };
    const clip = (r, s) => ({ left: Math.max(r.left, s.left), right: Math.min(r.right, s.right), top: Math.max(r.top, s.top), bottom: Math.min(r.bottom, s.bottom) });
    for (const el of document.querySelectorAll(".rb-root button, .rb-root label.rb-pick, .rb-root .rb-switch")) {
      let r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const name = (el.getAttribute("aria-label") || el.textContent || el.className).trim().slice(0, 40);
      if (r.height < 32 && !el.closest(".rb-toast")) out.push(`small touch target ${Math.round(r.width)}x${Math.round(r.height)}: ${name}`);
      for (const scroller of [el.closest(".rb-panel-body"), el.closest(".rb-card-scroll")].filter(Boolean)) r = clip(r, scroller.getBoundingClientRect());
      if (r.bottom <= r.top || r.right <= r.left) continue;
      if (r.bottom > chrome.band.top && (r.left < chrome.band.right || r.right > chrome.menuLeft))
        out.push(`overlaps runtime toolbar: ${name} (${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)})`);
      if (r.left < -0.5 || r.right > view.width + 0.5 || r.top < -0.5) out.push(`outside frame: ${name}`);
    }
    for (const el of document.querySelectorAll(".rb-root *")) {
      const style = getComputedStyle(el);
      if (el.children.length === 0 && el.textContent.trim() && el.scrollWidth > el.clientWidth + 1 && style.overflow === "visible" && style.display !== "inline")
        out.push(`text overflow: "${el.textContent.trim().slice(0, 30)}" (${el.scrollWidth} > ${el.clientWidth})`);
    }
    return out;
  }, chrome);
  for (const issue of issues) problems.push(`${label}: ${issue}`);
}

for (const scenario of SCENARIOS.filter(name => name.includes(filter))) {
  for (const size of SIZES) {
    const label = `${scenario}@${size.name}`;
    const { page, frame, logs } = await open(size, scenario);
    await page.screenshot({ path: path.join(outDir, `${scenario}-${size.name}.png`) });
    await checkLayout(page, frame, label);
    for (const log of logs) problems.push(`${label}: ${log}`);
    await page.close();
  }
}

// Keyboard checks on the 960 frame (keys go to the focused game iframe, as in the runtime).
async function keyboard() {
  const size = SIZES[0];
  const report = [];
  const describe = frame => frame.evaluate(() => {
    const el = document.activeElement;
    return `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}:${(el.getAttribute("aria-label") || el.textContent || el.value || "").trim().slice(0, 32)}`;
  });
  // Focus the game iframe before the modal mounts (&defer), like a player clicking "Find a match".
  const openFocused = async scenario => {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
    const logs = [], messages = [];
    page.on("console", message => {
      if (message.type() === "error" || message.type() === "warning") logs.push(`${message.type()}: ${message.text()}`);
      else messages.push(message.text());
    });
    page.on("pageerror", error => logs.push(`pageerror: ${error.message}`));
    await page.goto(`${server.url}?s=${scenario}&defer`);
    const frame = await (await page.waitForSelector("iframe")).contentFrame();
    await frame.waitForSelector(".rb-root");
    await page.locator("iframe").focus();
    await frame.evaluate(() => document.body.focus());
    await page.waitForTimeout(1500);
    return { page, frame, logs, messages };
  };
  {
    const { page, frame, logs, messages } = await openFocused("matchmaker");
    report.push(`matchmaker initial focus -> ${await describe(frame)}`);
    const seen = [];
    for (let i = 0; i < 7; i++) { await page.keyboard.press("Tab"); seen.push(await describe(frame)); }
    report.push(`matchmaker tab order -> ${seen.join(" | ")}`);
    if (!(await frame.evaluate(() => !!document.activeElement.closest(".rb-panel")))) problems.push("matchmaker: focus escaped the panel");
    await frame.focus('input[name$="parent-b"]:checked');
    await page.keyboard.press("ArrowRight");
    report.push(`matchmaker ArrowRight in parent B -> ${await frame.evaluate(() => document.querySelector('input[name$="parent-b"]:checked').value)}`);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(100);
    report.push(`matchmaker Enter on focused radio -> no breed: ${!messages.some(text => text.startsWith("breed"))}`);
    await frame.focus(".rb-breed");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(100);
    const bred = messages.find(text => text.startsWith("breed"));
    report.push(`matchmaker Enter on breed button -> ${bred ?? "nothing"}`);
    if (!bred) problems.push("matchmaker: breed button did not call onBreed");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    const closed = messages.includes("close");
    report.push(`matchmaker Escape -> onClose called: ${closed}`);
    if (!closed) problems.push("matchmaker: Escape did not call onClose");
    for (const log of logs) problems.push(`keyboard matchmaker: ${log}`);
    await page.close();
  }
  {
    const { page, frame } = await openFocused("brood");
    report.push(`brood initial focus -> ${await describe(frame)}`);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    report.push(`brood Tab+Enter -> detail visible: ${(await frame.locator(".rb-card-detail").count()) === 1}, focus ${await describe(frame)}`);
    await page.screenshot({ path: path.join(outDir, "brood-keyboard-960.png") });
    await page.close();
  }
  {
    const { page, frame } = await openFocused("reveal-mutant");
    report.push(`reveal initial focus -> ${await describe(frame)}`);
    for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
    report.push(`reveal Tab x3 stays in overlay: ${await frame.evaluate(() => !!document.activeElement.closest(".rb-hatch"))}`);
    await page.screenshot({ path: path.join(outDir, "reveal-focus-960.png") });
    await page.close();
  }
  {
    const { page, frame, logs, messages } = await openFocused("intro-1");
    report.push(`intro initial focus -> ${await describe(frame)}`);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(150);
    const title = await frame.locator(".rb-panel-title").textContent();
    report.push(`intro ArrowRight -> ${title}`);
    if (title !== "Find a match, hatch an egg") problems.push("intro: ArrowRight did not advance");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    if (!messages.includes("close")) problems.push("intro: Escape did not skip");
    report.push(`intro Escape -> onClose called: ${messages.includes("close")}`);
    for (const log of logs) problems.push(`keyboard intro: ${log}`);
    await page.close();
  }
  {
    const { page, frame } = await openFocused("hatching");
    report.push(`hatching initial focus -> ${await describe(frame)}`);
    await page.close();
  }
  {
    const { page, frame } = await open(size, "matchmaker-busy");
    report.push(`busy matchmaker close buttons: ${await frame.locator(".rb-panel-close").count()}`);
    await page.close();
  }
  {
    const { page, frame, logs } = await open(size, "settings");
    await frame.getByRole("switch", { name: /Reduce motion/ }).click();
    report.push(`settings reduce motion switch -> aria-checked=${await frame.getByRole("switch", { name: /Reduce motion/ }).getAttribute("aria-checked")}`);
    for (const log of logs) problems.push(`keyboard settings: ${log}`);
    await page.close();
  }
  return report;
}

if (!filter) for (const line of await keyboard()) console.log(line);

// Reduced motion: no confetti, no animation classes, no errors.
if (!filter) {
  const { page, frame, logs } = await open(SIZES[0], "reveal-prismatic", "&rm");
  await page.screenshot({ path: path.join(outDir, "reveal-prismatic-reduced-960.png") });
  const animated = await frame.locator(".rb-animate, .rb-confetti-bit").count();
  console.log(`reduced motion -> animated elements: ${animated}`);
  if (animated) problems.push("reduced motion: animated elements present");
  for (const log of logs) problems.push(`reduced motion: ${log}`);
  await page.close();
}

// Keyboard focus ring on a picker card after an arrow key (screenshot for review).
if (!filter) {
  const { page, frame } = await open(SIZES[0], "matchmaker");
  await page.locator("iframe").focus();
  await frame.focus('input[name$="parent-b"]:checked');
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, "matchmaker-keyboard-960.png") });
  await page.close();
}

// Intermediate frame sizes: layout checks only (compact threshold, runtime toolbar switch at 520 px).
if (!filter) {
  const MID = [{ name: "480", width: 482, height: 322 }, { name: "522", width: 524, height: 350 }, { name: "640", width: 642, height: 428 }, { name: "768", width: 770, height: 514 }];
  for (const size of MID) for (const scenario of ["nursery-prompt", "matchmaker-brood", "reveal-prismatic", "brood-detail", "settings", "error"]) {
    const { page, frame, logs } = await open(size, scenario);
    await checkLayout(page, frame, `${scenario}@${size.name}`);
    for (const log of logs) problems.push(`${scenario}@${size.name}: ${log}`);
    if (scenario === "matchmaker-brood" || scenario === "reveal-prismatic") await page.screenshot({ path: path.join(outDir, `${scenario}-${size.name}.png`) });
    await page.close();
  }
}

await browser.close();
await server.close();
console.log(problems.length ? `\n${problems.length} problem(s):\n${problems.join("\n")}` : "\nNo problems found.");
console.log(`Screenshots in ${outDir}`);
