#!/usr/bin/env node
// Build a GitHub Pages ready folder for a CLI game. Does not push or publish anything.
//   1. SDK CLI check:  node scripts/dev-game.mjs check <game>
//   2. SDK CLI build:  node scripts/dev-game.mjs build <game> --outdir <temporary>
//   3. Copy the generated files (not the SDK's internal output manifest) into --out, add .nojekyll,
//      verify relative paths and the sandbox document's CSP.
//   4. --smoke: serve --out under a GitHub Pages style sub-path (/<repo>/) with plain static
//      headers and boot it in headless Chromium with the automated-test wallet/RPC fixture.
//
//   node tools/build-pages.mjs [game-directory] [--out .friendsdk/site] [--smoke] [--base rare-breeds]
//
// The default output lives under the SDK root's .friendsdk/ directory, which .gitignore already ignores.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { parseArgs, promisify } from "node:util";
import { DEFAULT_GAME, SDK_ROOT, openMockRuntime, readDefinition, relativeToRoot } from "./lib/runtime.mjs";

const run = promisify(execFile);
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  out: { type: "string" }, smoke: { type: "boolean" }, base: { type: "string" }, help: { type: "boolean" },
} });
if (values.help) {
  console.log("Usage: node tools/build-pages.mjs [game-directory] [--out .friendsdk/site] [--smoke] [--base repository-name]");
  process.exit(0);
}
const gameDirectory = resolve(positionals[0] ?? DEFAULT_GAME);
const out = resolve(values.out ?? join(SDK_ROOT, ".friendsdk/site"));
const base = `/${(values.base ?? "rare-breeds").replace(/^\/+|\/+$/g, "")}/`;
const cli = join(SDK_ROOT, "scripts/dev-game.mjs");
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; media-src 'self' blob:; connect-src 'self' https://rpc.mainnet.chain.robinhood.com; base-uri 'none'; form-action 'none'; frame-src 'none'";
// Names the SDK build may emit (scripts/dev-game.mjs generatedName) plus our .nojekyll marker.
const PUBLISHED = /^(index\.html|game\.html|runtime\.js|game\.js|runtime\.css|game\.css|layout\.css|game-layout\.css|\.nojekyll|assets\/(?!\.)[^/\\]+-[A-Z0-9]{8}\.(png|jpg|webp|svg|woff2|mp3|wav))$/;

async function listFiles(root, prefix = "") {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(join(root, entry.name), `${name}/`));
    else files.push(name);
  }
  return files;
}

/** Only ever delete a previous output of this tool: every existing file must be a known generated name. */
async function prepareOutput() {
  for (const protectedPath of [resolve(SDK_ROOT), gameDirectory]) {
    assert(!(protectedPath === out || protectedPath.startsWith(out + sep)), `--out must not contain ${relativeToRoot(protectedPath) || "the SDK root"}`);
  }
  let existing = [];
  try { existing = await listFiles(out); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const foreign = existing.filter(name => !PUBLISHED.test(name));
  assert.deepEqual(foreign, [], `Refusing to overwrite ${out}: it contains files this tool did not generate`);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
}

function verifyHtml(name, html, files) {
  const references = [...html.matchAll(/\s(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  assert(references.length > 0, `${name} references no assets`);
  for (const reference of references) {
    assert(reference.startsWith("./") && !reference.includes(".."), `${name}: ${reference} must be a relative ./ path for sub-path hosting`);
    assert(files.includes(reference.slice(2)), `${name}: ${reference} is missing from the output`);
  }
  return references;
}

const definition = await readDefinition(gameDirectory);
console.log(`Pages build for ${definition.name} (${relativeToRoot(gameDirectory)}) -> ${relativeToRoot(out)}`);
const check = await run(process.execPath, [cli, "check", gameDirectory], { cwd: SDK_ROOT });
console.log(`check: ${relativeToRoot(check.stdout.trim())}`);
const temporary = await mkdtemp(join(tmpdir(), "rare-breeds-pages-"));
let server, browser;
try {
  const buildDirectory = join(temporary, "build");
  await run(process.execPath, [cli, "build", gameDirectory, "--outdir", buildDirectory], { cwd: SDK_ROOT });
  const manifest = JSON.parse(await readFile(join(buildDirectory, ".friendsdk-output.json"), "utf8"));
  const files = manifest.files.filter(name => PUBLISHED.test(name));
  assert.deepEqual(files, manifest.files, "Unexpected file in the SDK build output");
  for (const required of ["index.html", "game.html", "runtime.js", "game.js"]) assert(files.includes(required), `Build is missing ${required}`);
  console.log(`build: node scripts/dev-game.mjs build ${relativeToRoot(gameDirectory)} --outdir <temporary> (${files.length} files)`);

  await prepareOutput();
  for (const name of files) {
    await mkdir(dirname(join(out, name)), { recursive: true });
    await copyFile(join(buildDirectory, name), join(out, name));
  }
  await writeFile(join(out, ".nojekyll"), "");

  const index = await readFile(join(out, "index.html"), "utf8"), child = await readFile(join(out, "game.html"), "utf8");
  verifyHtml("index.html", index, files); verifyHtml("game.html", child, files);
  assert(child.includes(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`), "game.html lost the sandbox CSP");
  assert(!index.includes("Content-Security-Policy"), "index.html (trusted runtime) should carry no child CSP");
  assert((await readFile(join(out, "runtime.js"), "utf8")).includes("allow-scripts"), "runtime.js must mount the sandboxed iframe");
  assert(!/__friendWalletTest|installFixture/.test(await readFile(join(out, "runtime.js"), "utf8")), "Test fixtures must not reach the published runtime");

  let total = 0;
  const hash = createHash("sha256");
  for (const name of [...files, ".nojekyll"].sort()) {
    const content = await readFile(join(out, name)), size = content.length;
    total += size; hash.update(name).update(content);
    console.log(`  ${name.padEnd(28)} ${String(size).padStart(9)} bytes`);
  }
  console.log(`  total ${(total / 1024).toFixed(1)} KiB in ${files.length + 1} files; content sha256 ${hash.digest("hex").slice(0, 16)}`);
  console.log(`  game.html CSP: ${CSP}`);

  if (values.smoke) {
    // Plain static hosting like GitHub Pages: no CORS headers, served below a repository sub-path.
    const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml",
      ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".mp3": "audio/mpeg", ".wav": "audio/wav" };
    server = createServer(async (request, response) => {
      try {
        const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
        if (!pathname.startsWith(base)) { response.writeHead(404).end(); return; }
        const name = pathname.slice(base.length) || "index.html", file = resolve(out, name);
        if (!file.startsWith(out + sep) || !(await stat(file)).isFile()) { response.writeHead(404).end(); return; }
        response.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" }).end(await readFile(file));
      } catch { response.writeHead(404).end(); }
    });
    await new Promise((done, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", done); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    const session = await openMockRuntime(browser, origin, { url: `${origin}${base}`, viewport: { name: "desktop", width: 960, height: 800 } });
    const csp = await session.game.locator("body").evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content"));
    assert.equal(csp, CSP, "served game.html keeps its CSP");
    await session.game.locator("body").evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    assert.deepEqual(session.errors(), [], "Browser errors while booting the Pages folder");
    assert(await session.signedNothing(), "Fixture cannot sign transactions");
    console.log(`smoke: PASS ${origin}${base} boots the runtime, verifies fixture Friend #7730 and mounts the sandboxed game (CSP intact, no browser errors)`);
  }
  console.log(`Ready: publish the contents of ${relativeToRoot(out)} (including .nojekyll) as the root of a gh-pages branch. Nothing was pushed.`);
} finally {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  await rm(temporary, { recursive: true, force: true });
}
