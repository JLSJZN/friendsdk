// Dev-only: screenshots every harness scenario at 960 x 640, 390 x 520 and 360 x 480 (3:4 portrait), 390 x 651 and 360 x 642
// (the taller portrait frames host.css gives most phones), 390 x 260 and 360 x 240 (inside the real SDK frame chrome; the intro
// and help panels also at 328 x 437), fails on console errors and clipped text, and runs keyboard checks.
// Usage: node dev/ui/shots.mjs [scenario-filter]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./serve.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "shots");
const filter = process.argv[2] ?? "";
const SCENARIOS = ["thumbs", "nursery", "nursery-prompt", "nursery-prompt-long", "matchmaker", "matchmaker-buy", "matchmaker-broke", "matchmaker-busy",
  "matchmaker-brood", "matchmaker-first", "matchmaker-stock", "matchmaker-preferred", "intro-1", "intro-2", "intro-3", "intro-4", "intro-5", "intro-6", "nursery-coach",
  "shop", "shop-wish", "eggs", "eggs-stocked", "eggs-broke", "hatching", "reveal-common", "reveal-spotted", "reveal-mutant", "reveal-prismatic", "reveal-f3",
  "reveal-inherit", "reveal-echo", "brood-inherit", "brood-book", "brood", "brood-detail", "brood-empty", "brood-tabs", "brood-legacy", "brood-legacy-ghost", "brood-legacy-empty", "brood-legacy-detail", "friend-panel",
  "settings", "settings-stations", "settings-screen", "loading", "error",
  "slingshot", "slingshot-many", "slingshot-crowd", "slingshot-empty", "slingshot-marks", "slingshot-blocked", "slingshot-busy", "slingshot-ready", "slingshot-flying", "slingshot-pond", "slingshot-jump",
  "slingshot-record", "slingshot-crash",
  "slingshot-moon", "slingshot-hud", "slingshot-hud-down", "slingshot-hint", "slingshot-settings", "slingshot-intro"];
// Page viewport = frame + its 1px border, so the SDK frame renders at exactly 960 x 640 / 390 x 260 / 360 x 240.
// 390p and 360p are 3:4 portrait frames (host.css's fallback step: 390 x 520, 360 x 480). 390t is the 3:5 frame of a
// 390 x 664 iPhone Safari view (390 x 651 inside the border), 360t the 9:16 frame of a 360 x 640 Android phone.
const SIZES = [{ name: "960", width: 962, height: 642 }, { name: "390p", width: 392, height: 522 }, { name: "360p", width: 362, height: 482 },
  { name: "390t", width: 392, height: 654 }, { name: "360t", width: 362, height: 644 }, { name: "390", width: 392, height: 262 }, { name: "360", width: 362, height: 242 }];
// The onboarding panels also at the narrowest portrait frame (a 328 px wide phone: 328 x 437).
const ONBOARDING = /^(intro-|settings)/;
const NARROW = { name: "328p", width: 330, height: 439 };

// Scenarios that need longer before the shot: the Moon ride flies for 9 s before its result card, the record and crash
// stories jump (or give out) after 1.5 s and 3.2 s.
const SETTLE = { "slingshot-moon": 10_500, "slingshot-record": 3000, "slingshot-crash": 4500 };

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
  await page.waitForTimeout(SETTLE[scenario] ?? 1300);
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
    // Station prompts ellipsize by design; any truncation means the label lost its point.
    for (const el of document.querySelectorAll(".rb-prompt > span, .rb-sling-zone-name > span:not(.rb-tag), :is(.rb-intro, .rb-settings) .rb-button > span"))
      if (el.getClientRects().length && el.scrollWidth > el.clientWidth + 1) out.push(`label truncated: "${el.textContent.trim()}" (${el.scrollWidth} > ${el.clientWidth})`);
    // The intro and help panels scroll only vertically: nothing may stick out past the body's sides (a clipped chip or pill).
    for (const body of document.querySelectorAll(":is(.rb-intro, .rb-settings) .rb-panel-body")) {
      const box = body.getBoundingClientRect();
      if (body.scrollWidth > body.clientWidth + 1) out.push(`panel body scrolls sideways (${body.scrollWidth} > ${body.clientWidth})`);
      for (const el of body.querySelectorAll("*")) {
        if (el.closest(".rb-sr-only")) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.right > box.right + 0.5 || r.left < box.left - 0.5)
          out.push(`clipped at the panel edge: "${(el.textContent || el.className).trim().slice(0, 30)}" (${Math.round(r.left)} to ${Math.round(r.right)}, body ${Math.round(box.left)} to ${Math.round(box.right)})`);
        // A box whose own content is wider than it (e.g. a nowrap title running into its neighbour). Tags placed
        // outside their box on purpose (position: absolute, like the intro's "Example" tag) do not count.
        else if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && getComputedStyle(el).overflowX === "visible" && getComputedStyle(el).display !== "inline"
          && ![...el.querySelectorAll("*")].some(child => getComputedStyle(child).position === "absolute"))
          out.push(`content wider than its box: "${(el.textContent || el.className).trim().slice(0, 30)}" (${el.scrollWidth} > ${el.clientWidth})`);
      }
    }
    return out;
  }, chrome);
  for (const issue of issues) problems.push(`${label}: ${issue}`);
}

for (const scenario of SCENARIOS.filter(name => name.includes(filter))) {
  for (const size of ONBOARDING.test(scenario) ? [...SIZES, NARROW] : SIZES) {
    const label = `${scenario}@${size.name}`;
    const { page, frame, logs } = await open(size, scenario);
    await page.screenshot({ path: path.join(outDir, `${scenario}-${size.name}.png`) });
    await checkLayout(page, frame, label);
    for (const log of logs) problems.push(`${label}: ${log}`);
    await page.close();
  }
}

const describe = frame => frame.evaluate(() => {
  const el = document.activeElement;
  return `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}:${(el.getAttribute("aria-label") || el.textContent || el.value || "").trim().slice(0, 32)}`;
});
// Focus the game iframe before the modal mounts (&defer), like a player clicking "Find a match".
async function openFocused(scenario, extra = "") {
  const size = SIZES[0];
  const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
  const logs = [], messages = [];
  page.on("console", message => {
    if (message.type() === "error" || message.type() === "warning") logs.push(`${message.type()}: ${message.text()}`);
    else messages.push(message.text());
  });
  page.on("pageerror", error => logs.push(`pageerror: ${error.message}`));
  await page.goto(`${server.url}?s=${scenario}&defer${extra}`);
  const frame = await (await page.waitForSelector("iframe")).contentFrame();
  await frame.waitForSelector(".rb-root");
  await page.locator("iframe").focus();
  await frame.evaluate(() => document.body.focus());
  await page.waitForTimeout(1500);
  return { page, frame, logs, messages };
}

// Keyboard checks on the 960 frame (keys go to the focused game iframe, as in the runtime).
async function keyboard() {
  const size = SIZES[0];
  const report = [];
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
    if (title !== "Your nursery") problems.push("intro: ArrowRight did not advance");
    for (let i = 0; i < 5; i++) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(120); }
    const end = await frame.locator(".rb-panel-title").textContent();
    report.push(`intro ArrowRight x5 more -> ${end}, eyebrow "${await frame.locator(".rb-eyebrow").textContent()}", focus ${await describe(frame)}`);
    if (end !== "Your screen") problems.push(`intro: the last step is "${end}"`);
    if (!(await describe(frame)).includes("Start breeding")) problems.push("intro: focus is not on Start breeding on the last step");
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

// Moon Slingshot: the panel by keyboard (picker arrows, Launch, busy, Escape), then the flight: hold to fly with Space or the
// pointer, let go to jump, Escape before ignition (Don't fly) and after the jump (skip), the result card and the HUD net pill.
async function slingshotKeyboard() {
  const report = [];
  const meter = frame => frame.evaluate(() => ({
    stage: document.querySelector(".rb-launch")?.getAttribute("data-stage") ?? "none",
    mult: document.querySelector(".rb-flight-mult")?.textContent ?? "",
    label: document.querySelector(".rb-flight-hold")?.textContent?.trim() ?? "",
  }));
  /** Launch from the panel with Enter and wait for the (faked) trade-in confirmation to open the flight. */
  const toFlight = async (page, frame) => {
    await frame.focus(".rb-sling-go");
    await page.keyboard.press("Enter");
    await frame.waitForSelector(".rb-flight-hold", { timeout: 3000 });
    await page.waitForTimeout(300);
  };
  {
    const { page, frame, logs, messages } = await openFocused("slingshot");
    report.push(`slingshot initial focus -> ${await describe(frame)}`);
    const seen = [];
    for (let i = 0; i < 4; i++) { await page.keyboard.press("Tab"); seen.push(await describe(frame)); }
    report.push(`slingshot tab order -> ${seen.join(" | ")}`);
    for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
    if (!(await frame.evaluate(() => !!document.activeElement.closest(".rb-panel")))) problems.push("slingshot: focus escaped the panel");
    await frame.focus('input[name$="-baby"]:checked');
    await page.keyboard.press("ArrowLeft");
    const picked = await frame.evaluate(() => document.querySelector('input[name$="-baby"]:checked').value);
    report.push(`slingshot ArrowLeft in the picker -> ${picked}, stake line: ${(await frame.locator(".rb-sling-stake .rb-long").textContent()).slice(0, 40)}`);
    await frame.focus(".rb-sling-go");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    const launches = messages.filter(text => text.startsWith("launch"));
    report.push(`slingshot Enter on Launch -> ${launches.join(", ") || "nothing"}`);
    if (launches.length !== 1) problems.push(`slingshot: Enter launched ${launches.length} times`);
    report.push(`slingshot busy while confirming -> disabled ${await frame.locator(".rb-sling-go").isDisabled()}, "${(await frame.locator(".rb-sling-go .rb-long").textContent())}"`);
    for (const log of logs) problems.push(`keyboard slingshot: ${log}`);
    await page.close();
  }
  {
    const { page, frame, messages } = await openFocused("slingshot");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    report.push(`slingshot Escape in the panel -> onClose called: ${messages.includes("close")}`);
    if (!messages.includes("close")) problems.push("slingshot: Escape did not close the panel");
    await page.close();
  }
  {
    // Crash point x5.99 (roll 1500): Space held 1.6 s climbs past x1.5, releasing jumps; Escape skips the ending.
    const { page, frame, logs, messages } = await openFocused("slingshot", "&roll=1500");
    await toFlight(page, frame);
    report.push(`slingshot flight initial focus -> ${await describe(frame)}`);
    await page.keyboard.down(" ");
    await page.waitForTimeout(1600);
    const mid = await meter(frame);
    report.push(`slingshot Space held 1.6 s -> ${mid.stage}, ${mid.mult}, "${mid.label}"`);
    if (mid.stage !== "flying" || !(Number(mid.mult.slice(1)) >= 1.5)) problems.push(`slingshot: after 1.6 s of Space ${JSON.stringify(mid)}`);
    await page.screenshot({ path: path.join(outDir, "slingshot-holding-960.png") });
    await page.keyboard.up(" ");
    await page.waitForTimeout(150);
    report.push(`slingshot Space released -> ${messages.filter(text => text.startsWith("settle")).join(", ") || "not booked"}`);
    await page.keyboard.press("Escape");
    await frame.waitForSelector(".rb-launch-card", { timeout: 3000 }).catch(() => {});
    report.push(`slingshot Escape after the jump -> result card: ${(await frame.locator(".rb-launch-card").count()) === 1}, "${await frame.locator(".rb-launch-zone").textContent().catch(() => "")}"`);
    report.push(`slingshot result focus -> ${await describe(frame)}`);
    for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
    const inside = await frame.evaluate(() => !!document.activeElement.closest(".rb-launch"));
    report.push(`slingshot result Tab x3 stays in overlay: ${inside}`);
    if (!inside) problems.push("slingshot: focus escaped the launch overlay");
    report.push(`slingshot result sums -> ${(await frame.locator(".rb-launch-sums").innerText()).replace(/\s+/g, " ")}`);
    await page.waitForTimeout(450);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const pill = await frame.locator(".rb-hud-sling").count() ? await frame.locator(".rb-hud-sling").getAttribute("aria-label") : "missing";
    report.push(`slingshot Escape on result -> overlay closed: ${(await frame.locator(".rb-launch").count()) === 0}, HUD pill: ${pill}`);
    if (!/Slingshot net, simulated RF: \+\d[\d.]* RF/.test(pill)) problems.push(`slingshot: HUD net pill after a jump reads "${pill}"`);
    for (const log of logs) problems.push(`keyboard slingshot flow: ${log}`);
    await page.close();
  }
  {
    // Pointer hold on a Moon roll: holding climbs, letting go jumps (no Moon: it let go first).
    const { page, frame, messages } = await openFocused("slingshot", "&roll=0");
    await toFlight(page, frame);
    const box = await frame.locator(".rb-flight-hold").boundingBox();
    const offset = await page.evaluate(() => document.querySelector("iframe").getBoundingClientRect().toJSON());
    await page.mouse.move(offset.left + box.x + box.width / 2, offset.top + box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(900);
    const held = await meter(frame);
    await page.mouse.up();
    await page.waitForTimeout(200);
    report.push(`slingshot pointer hold 900 ms -> ${held.mult} "${held.label}", then ${messages.filter(text => text.startsWith("settle")).join(", ") || "not booked"}`);
    if (held.stage !== "flying" || !messages.some(text => text.startsWith("settle") && text.endsWith("jump"))) problems.push(`slingshot: pointer hold ${JSON.stringify(held)} ${messages.join(" | ")}`);
    await page.close();
  }
  {
    // Escape before lighting the rocket: Don't fly (nothing booked).
    const { page, frame, messages } = await openFocused("slingshot", "&roll=0");
    await toFlight(page, frame);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    const booked = messages.some(text => text.startsWith("settle") || text.startsWith("ignite"));
    report.push(`slingshot Escape before ignition -> cancel: ${messages.includes("cancel")}, booked: ${booked}`);
    if (!messages.includes("cancel") || booked) problems.push("slingshot: Escape before ignition did not leave without a flight");
    await page.close();
  }
  {
    // Enter held through a flight the rocket ends by itself (x1.12 on roll 8000): its auto-repeat must neither skip the
    // ending nor close the result card; a real press afterwards does.
    const { page, frame, messages } = await openFocused("slingshot", "&roll=8000");
    await toFlight(page, frame);
    await page.keyboard.down("Enter");
    for (let i = 0; i < 90; i++) { await page.keyboard.down("Enter"); await page.waitForTimeout(33); }
    const held = await meter(frame);
    await page.keyboard.up("Enter");
    await page.waitForTimeout(700);
    const open = await frame.locator(".rb-launch-card").count(), closed = messages.includes("close");
    report.push(`slingshot Enter held through a crash (3 s of auto-repeat) -> stage ${held.stage}, result card open: ${open === 1}, closed: ${closed}`);
    if (open !== 1 || closed) problems.push("slingshot: a held Enter closed the result card");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    report.push(`slingshot a real Enter press on the result -> closed: ${messages.includes("close")}`);
    if (!messages.includes("close")) problems.push("slingshot: Enter on Back to the nursery did not close after the held key was released");
    await page.close();
  }
  {
    // Space held through the crash: releasing it must not skip the ending (Space clicks on keyup).
    const { page, frame } = await openFocused("slingshot", "&roll=8000");
    await toFlight(page, frame);
    await page.keyboard.down(" ");
    for (let i = 0; i < 30; i++) { await page.keyboard.down(" "); await page.waitForTimeout(33); }
    const before = await meter(frame);
    await page.keyboard.up(" ");
    await page.waitForTimeout(120);
    const after = await meter(frame);
    report.push(`slingshot Space held through a crash, then released -> ${before.stage} then ${after.stage}`);
    if (before.stage !== "ending" || after.stage !== "ending") problems.push(`slingshot: releasing a held Space skipped the ending (${before.stage} -> ${after.stage})`);
    await frame.waitForSelector(".rb-launch-card", { timeout: 6000 }).catch(() => {});
    report.push(`slingshot ... then the result card by itself: ${(await frame.locator(".rb-launch-card").count()) === 1}`);
    await page.close();
  }
  {
    // Mounted while paused: focus on the hold button (aria-disabled), never on Don't fly; after the pause Space flies.
    const { page, frame, messages } = await openFocused("slingshot-paused");
    const focus = await describe(frame);
    report.push(`slingshot mounted paused -> focus ${focus}, aria-disabled ${await frame.locator(".rb-flight-hold").getAttribute("aria-disabled")}`);
    if (!focus.includes("Hold to fly")) problems.push(`slingshot: mounted paused, focus is on ${focus}`);
    await page.keyboard.press(" ");
    await page.waitForTimeout(150);
    if (messages.includes("close") || (await meter(frame)).stage !== "ready") problems.push("slingshot: Space while paused did something");
    await frame.waitForFunction(() => !document.querySelector(".rb-flight-hold")?.hasAttribute("aria-disabled"), null, { timeout: 4000 });
    await page.keyboard.down(" ");
    await page.waitForTimeout(500);
    const flying = await meter(frame);
    await page.keyboard.up(" ");
    await page.waitForTimeout(150);
    report.push(`slingshot after the pause, Space -> ${flying.stage} ${flying.mult}, then ${messages.filter(text => text.startsWith("settle")).join(", ") || "not booked"}`);
    if (flying.stage !== "flying" || !messages.some(text => text.startsWith("settle"))) problems.push("slingshot: after the pause Space did not fly and jump");
    await page.close();
  }
  {
    // Unmounted mid-air: the flight is booked at the multiplier showing, never left lit.
    const { page, messages } = await openFocused("slingshot-unmount");
    await page.waitForTimeout(1200);
    const booked = messages.filter(text => text.startsWith("settle"));
    report.push(`slingshot unmounted mid-air -> ${messages.includes("unmount") ? "unmounted" : "still mounted"}, ${booked.join(", ") || "not booked"}`);
    if (!messages.includes("unmount") || booked.length !== 1 || !booked[0].endsWith("jump")) problems.push(`slingshot: unmount mid-air booked ${booked.join(", ") || "nothing"}`);
    await page.close();
  }
  {
    const { page, frame } = await openFocused("slingshot-blocked");
    report.push(`slingshot blocked -> disabled ${await frame.locator(".rb-sling-go").isDisabled()}, "${await frame.locator(".rb-sling-status").innerText()}"`);
    await page.close();
  }
  {
    const { page, frame } = await openFocused("slingshot-empty");
    report.push(`slingshot empty initial focus -> ${await describe(frame)}`);
    await page.close();
  }
  {
    const { page, frame, logs } = await open(SIZES[0], "slingshot-moon", "&rm");
    const animated = await frame.locator(".rb-animate, .rb-confetti-bit").count();
    report.push(`slingshot moon reduced motion -> animated elements: ${animated}, result: "${await frame.locator(".rb-launch-zone").textContent().catch(() => "none")}"`);
    if (animated) problems.push("slingshot reduced motion: animated elements present");
    for (const log of logs) problems.push(`slingshot reduced motion: ${log}`);
    await page.close();
  }
  return report;
}

if (!filter || filter.includes("slingshot")) for (const line of await slingshotKeyboard()) console.log(line);

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
  for (const size of MID) for (const scenario of ["nursery-prompt", "nursery-prompt-long", "slingshot-hint", "slingshot", "matchmaker-brood", "reveal-prismatic", "brood-detail", "settings", "error"]) {
    const { page, frame, logs } = await open(size, scenario);
    await checkLayout(page, frame, `${scenario}@${size.name}`);
    for (const log of logs) problems.push(`${scenario}@${size.name}: ${log}`);
    if (["matchmaker-brood", "reveal-prismatic", "slingshot", "nursery-prompt-long"].includes(scenario)) await page.screenshot({ path: path.join(outDir, `${scenario}-${size.name}.png`) });
    await page.close();
  }
  // Short portrait frames (the 3:4 fallback under 480 tall, e.g. a 360 x 500 view): the slingshot and the station prompt.
  const PORTRAIT = [{ name: "328p", width: 330, height: 439 }, { name: "358p", width: 360, height: 479 }];
  for (const size of PORTRAIT) for (const scenario of ["nursery-prompt-long", "slingshot-hint", "slingshot", "slingshot-crowd", "slingshot-busy", "slingshot-pond", "slingshot-hud"]) {
    const { page, frame, logs } = await open(size, scenario);
    await checkLayout(page, frame, `${scenario}@${size.name}`);
    for (const log of logs) problems.push(`${scenario}@${size.name}: ${log}`);
    await page.screenshot({ path: path.join(outDir, `${scenario}-${size.name}.png`) });
    await page.close();
  }
}

await browser.close();
await server.close();
console.log(problems.length ? `\n${problems.length} problem(s):\n${problems.join("\n")}` : "\nNo problems found.");
console.log(`Screenshots in ${outDir}`);
