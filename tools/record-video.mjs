#!/usr/bin/env node
// Record a scripted playthrough in the same mocked runtime as testGame (mock wallet, mock RPC,
// recorded #7730 art, real runtime + sandbox), with reduced motion OFF so animations play.
// Playwright recordVideo writes a 960 x 640 WebM; ffmpeg converts it to MP4 and an optimised GIF.
//
//   node tools/record-video.mjs [game-directory] [--scenario file.mjs] [--name gameplay] [--media dir]
//        [--keep-intro] [--keep-webm] [--no-mp4] [--no-gif] [--gif-width 640] [--gif-fps 12] [--timeout ms]
//
// Scenario: named export `video` (array of steps or async ctx => {}) from tools/scenarios/<game>.mjs
// by default. See tools/lib/runtime.mjs runSteps for the step list.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";
import { chromium } from "playwright";
import { buildGame } from "@rarefriends/friendsdk/build";
import { createGameServer } from "@rarefriends/friendsdk/serve";
import {
  DEFAULT_GAME, createHelpers, defaultScenarioPath, loadScenario, openMockRuntime, readDefinition, relativeToRoot, runScenarioPart,
} from "./lib/runtime.mjs";

const run = promisify(execFile);
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  scenario: { type: "string" }, name: { type: "string" }, media: { type: "string" }, timeout: { type: "string" },
  "keep-intro": { type: "boolean" }, "keep-webm": { type: "boolean" }, "no-mp4": { type: "boolean" }, "no-gif": { type: "boolean" },
  "gif-width": { type: "string" }, "gif-fps": { type: "string" }, help: { type: "boolean" },
} });
if (values.help) {
  console.log("Usage: node tools/record-video.mjs [game-directory] [--scenario file.mjs] [--name gameplay] [--media dir] [--keep-intro] [--keep-webm] [--no-mp4] [--no-gif] [--gif-width 640] [--gif-fps 12]");
  process.exit(0);
}
const gameDirectory = resolve(positionals[0] ?? DEFAULT_GAME);
const media = resolve(values.media ?? join(gameDirectory, "docs/media"));
const name = values.name ?? "gameplay";
const timeout = Number(values.timeout ?? 20_000);
const gifWidth = Number(values["gif-width"] ?? 640), gifFps = Number(values["gif-fps"] ?? 12);
const VIDEO = Object.freeze({ name: "video", width: 960, height: 640, touch: false });

/** Generic fallback: walk the player around so any canvas game shows motion. */
const DEFAULT_STEPS = [
  { wait: 800 }, { focus: { css: "canvas" } },
  { key: "ArrowRight", hold: 700 }, { key: "ArrowDown", hold: 500 }, { key: "ArrowLeft", hold: 900 }, { key: "ArrowUp", hold: 500 },
  { wait: 1000 },
];

async function findFfmpeg() {
  const candidates = ["ffmpeg"];
  try {
    const cache = join(homedir(), process.platform === "darwin" ? "Library/Caches/ms-playwright" : ".cache/ms-playwright");
    for (const entry of (await readdir(cache)).filter(entry => entry.startsWith("ffmpeg-")).sort().reverse()) {
      for (const file of await readdir(join(cache, entry))) if (file.startsWith("ffmpeg")) candidates.push(join(cache, entry, file));
    }
  } catch { /* no Playwright cache */ }
  for (const command of candidates) {
    try {
      const { stdout } = await run(command, ["-hide_banner", "-encoders"], { maxBuffer: 1 << 22 });
      return { command, x264: /\blibx264\b/.test(stdout), gif: /^\s*V\S*\s+gif\b/m.test(stdout) };
    } catch { /* try the next one */ }
  }
  return null;
}

async function sizeOf(path) { return `${((await stat(path)).size / 1024 / 1024).toFixed(2)} MB`; }

const definition = await readDefinition(gameDirectory);
const scenarioPath = values.scenario ?? await defaultScenarioPath(gameDirectory);
const scenario = await loadScenario(scenarioPath);
const temporary = await mkdtemp(join(tmpdir(), "rare-breeds-video-"));
let build, server, browser;
try {
  build = await buildGame(gameDirectory, { outdir: join(temporary, "dist") });
  server = createGameServer(build.outdir);
  await new Promise((done, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", done); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const session = await openMockRuntime(browser, origin, { viewport: VIDEO, reducedMotion: "no-preference", timeout,
    recordVideo: { dir: join(temporary, "video"), size: { width: VIDEO.width, height: VIDEO.height } } });
  const { page, game, context } = session;
  assert.equal(await game.locator("body").evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), false, "reduced motion must be off");
  const readyAt = Date.now();
  // Pre-roll: the screencast lags the page by a few frames, so hold still before the scenario and trim into it.
  await page.waitForTimeout(500);
  console.log(`Recording ${definition.name}; scenario ${scenarioPath ? relativeToRoot(scenarioPath) : "built-in walk"}`);
  const helpers = createHelpers({ page, game, definition, viewport: VIDEO, mediaDirectory: media, prefix: `${name}-` });
  const ctx = { page, game, friendId: 7730n, viewport: VIDEO, definition, helpers, timeout };
  if (!await runScenarioPart(scenario.video, ctx, { label: "[video] " })) await runScenarioPart(DEFAULT_STEPS, ctx, { label: "[video] " });
  await page.waitForTimeout(400);
  await mkdir(media, { recursive: true });
  const poster = join(media, `${name}-poster.png`);
  await page.locator(".rf-game-frame").screenshot({ path: poster });
  assert.deepEqual(session.errors(), [], "Game browser errors during the recording");
  assert(await session.signedNothing(), "Fixture cannot sign transactions");
  const video = page.video();
  await context.close();
  const webm = await video.path();
  const trim = values["keep-intro"] ? 0 : (readyAt - session.startedAt) / 1000 + 0.25;
  const outputs = [`poster ${relativeToRoot(poster)}`];
  if (values["keep-webm"]) { await copyFile(webm, join(media, `${name}.webm`)); outputs.push(`webm ${relativeToRoot(join(media, `${name}.webm`))} (${await sizeOf(join(media, `${name}.webm`))}, includes intro)`); }
  const ffmpeg = await findFfmpeg();
  if (!ffmpeg || (!ffmpeg.x264 && !ffmpeg.gif)) {
    await copyFile(webm, join(media, `${name}.webm`));
    console.warn(`No ffmpeg with libx264/gif encoders found${ffmpeg ? ` (${ffmpeg.command} only writes WebM)` : ""}. Kept ${relativeToRoot(join(media, `${name}.webm`))}. Install ffmpeg (brew install ffmpeg) for MP4/GIF.`);
  } else {
    const seek = trim ? ["-ss", trim.toFixed(2)] : [];
    if (!values["no-mp4"]) {
      if (!ffmpeg.x264) console.warn(`${ffmpeg.command} has no libx264; skipped MP4.`);
      else {
        const mp4 = join(media, `${name}.mp4`);
        await run(ffmpeg.command, ["-y", "-loglevel", "error", ...seek, "-i", webm, "-vf", "fps=30,format=yuv420p", "-c:v", "libx264",
          "-preset", "slow", "-crf", "18", "-tune", "animation", "-movflags", "+faststart", "-an", mp4]);
        outputs.push(`mp4 ${relativeToRoot(mp4)} (${await sizeOf(mp4)})`);
      }
    }
    if (!values["no-gif"]) {
      const gif = join(media, `${name}.gif`);
      // Two-pass palette: the 1-bit art plus tier accents fits in 64 colours; diff mode keeps static areas stable.
      await run(ffmpeg.command, ["-y", "-loglevel", "error", ...seek, "-i", webm, "-vf",
        `fps=${gifFps},scale=${gifWidth}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
        "-loop", "0", gif]);
      outputs.push(`gif ${relativeToRoot(gif)} (${await sizeOf(gif)}, ${gifWidth}px, ${gifFps} fps)`);
    }
  }
  console.log(`Recorded ${((Date.now() - readyAt) / 1000).toFixed(1)}s of gameplay (intro trimmed: ${trim.toFixed(2)}s) with ${ffmpeg?.command ?? "no ffmpeg"}`);
  for (const line of outputs) console.log(`  ${line}`);
  for (const item of helpers.confirmations) console.log(`  runtime confirmation ${item.action}: "${item.title}" / "${item.description}"${item.amount ? ` / ${item.amount}` : ""}`);
} finally {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  await build?.close();
  await rm(temporary, { recursive: true, force: true });
}
