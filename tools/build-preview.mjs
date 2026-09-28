#!/usr/bin/env node
// Build the Rare Breeds preview page: a static, wallet-free explainer of the game's mechanics (not the game).
// It bundles games/rare-breeds/preview/src/main.ts with esbuild, reusing the game's pure modules (genetics, sprites,
// drawing, the hatch and flight scenes), and copies the page, its CSS, the wild Friend pool and the trailer.
//
//   node tools/build-preview.mjs [--out dir] [--serve [port]] [--watch]
//
// Output: .friendsdk/preview-site/ (never inside .friendsdk/site, which tools/build-pages.mjs owns). All paths are
// relative, so the folder works as https://<user>.github.io/<repo>/preview/ next to the game at the site root.
import { context, build } from "esbuild";
import { createServer } from "node:http";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const GAME = join(ROOT, "games/rare-breeds");
const PAGE = join(GAME, "preview");
const { values } = parseArgs({ options: {
  out: { type: "string" }, serve: { type: "string" }, watch: { type: "boolean" }, help: { type: "boolean" },
}, allowPositionals: false, strict: false });
if (values.help) {
  console.log("Usage: node tools/build-preview.mjs [--out dir] [--serve [port]] [--watch]");
  process.exit(0);
}
const out = resolve(values.out ?? join(ROOT, ".friendsdk/preview-site"));
if (out === resolve(ROOT, ".friendsdk/site") || out.startsWith(resolve(ROOT, ".friendsdk/site") + "/")) {
  throw new Error("The preview must not be built into .friendsdk/site (tools/build-pages.mjs owns that folder).");
}

// The flight scene imports src/slingshot.ts for its maths. That file also carries a React hook and the SDK's preview
// roll, which the page does not need: both resolve to small local stand-ins, so no React or SDK code is bundled.
const stubs = {
  name: "preview-stubs",
  setup(buildApi) {
    buildApi.onResolve({ filter: /^react$/ }, () => ({ path: join(PAGE, "src/stubs/react.ts") }));
    buildApi.onResolve({ filter: /^@rarefriends\/friendsdk\/game$/ }, () => ({ path: join(PAGE, "src/stubs/game.ts") }));
  },
};

const options = {
  entryPoints: [join(PAGE, "src/main.ts")],
  outfile: join(out, "preview.js"),
  bundle: true, format: "esm", platform: "browser", target: "es2022",
  minify: !values.watch, sourcemap: values.watch ? "inline" : false,
  legalComments: "none", logLevel: "warning", plugins: [stubs],
};

async function copyStatic() {
  await mkdir(join(out, "media"), { recursive: true });
  await mkdir(join(out, "data"), { recursive: true });
  await copyFile(join(PAGE, "index.html"), join(out, "index.html"));
  await copyFile(join(PAGE, "preview.css"), join(out, "preview.css"));
  await copyFile(join(GAME, "data/wild-friends.json"), join(out, "data/wild-friends.json"));
  // The trailer (tools/scenarios/rare-breeds-trailer.mjs); until it exists, the older gameplay clip stands in.
  const media = join(GAME, "docs/media");
  const trailer = existsSync(join(media, "trailer.mp4")) ? "trailer" : "gameplay";
  await copyFile(join(media, `${trailer}.mp4`), join(out, "media/trailer.mp4"));
  const poster = existsSync(join(media, `${trailer}-poster.png`)) ? `${trailer}-poster.png` : "gameplay-poster.png";
  await copyFile(join(media, poster), join(out, "media/trailer-poster.png"));
  for (const file of ["genetics-inherit.png", "genetics-sheet.png"]) await copyFile(join(media, file), join(out, "media", file));
  await writeFile(join(out, ".nojekyll"), "");
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await copyStatic();
if (values.watch) {
  const ctx = await context({ ...options, plugins: [...options.plugins, { name: "copy", setup(b) { b.onEnd(() => copyStatic().catch(console.error)); } }] });
  await ctx.rebuild();
  await ctx.watch();
  // esbuild only watches the script graph: copy the page and its CSS again when they change.
  const { watch } = await import("node:fs");
  watch(PAGE, (_, file) => { if (file && /\.(html|css)$/.test(file)) copyStatic().catch(console.error); });
} else {
  await build(options);
}
const { size } = await stat(join(out, "preview.js"));
console.log(`Preview page built in ${out} (preview.js ${(size / 1024).toFixed(1)} KB).`);

if (values.serve !== undefined) {
  const port = Number(values.serve || 4321) || 4321;
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
    ".png": "image/png", ".mp4": "video/mp4", ".webm": "video/webm", ".svg": "image/svg+xml" };
  createServer(async (request, response) => {
    try {
      let path = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname);
      if (path.endsWith("/")) path += "index.html";
      const file = resolve(out, "." + path);
      if (!file.startsWith(out)) throw new Error("outside");
      const body = await readFile(file);
      const range = request.headers.range?.match(/bytes=(\d*)-(\d*)/);
      const headers = { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store", "accept-ranges": "bytes" };
      if (range) {
        const start = Number(range[1] || 0), end = range[2] ? Number(range[2]) : body.length - 1;
        response.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${body.length}`, "content-length": end - start + 1 });
        response.end(body.subarray(start, end + 1));
      } else {
        response.writeHead(200, { ...headers, "content-length": body.length });
        response.end(body);
      }
    } catch {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("Not found");
    }
  }).listen(port, "127.0.0.1", () => console.log(`Serving the preview at http://127.0.0.1:${port}/`));
}
