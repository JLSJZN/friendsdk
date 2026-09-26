// Dev-only local play harness: bundles dev/play/play.tsx with esbuild (rebuilt on every page load)
// and serves it on 127.0.0.1 with the SDK child document's CSP. Mounts the real game with the low-level SDK preview client (no wallet, no runtime confirmations). Never publish it. Usage: node dev/play/serve.mjs [port]
import { context } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sdkRoot = path.resolve(here, "../..");
const packageJson = JSON.parse(await readFile(path.join(sdkRoot, "package.json"), "utf8"));
// Child (game) documents get the SDK child CSP; the parent page may frame its own origin.
const CHILD_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self' https://rpc.mainnet.chain.robinhood.com; base-uri 'none'; form-action 'none'; frame-src 'none'";
const PARENT_CSP = CHILD_CSP.replace("frame-src 'none'", "frame-src 'self'");

const sdkExports = {
  name: "friendsdk-exports",
  setup(build) {
    build.onResolve({ filter: /^@rarefriends\/friendsdk(?:\/|$)/ }, args => {
      const name = args.path.replace("@rarefriends/friendsdk", ".") || ".";
      const entry = packageJson.exports[name];
      if (!entry) return { errors: [{ text: `Unknown SDK export: ${args.path}` }] };
      return { path: path.join(sdkRoot, typeof entry === "string" ? entry : entry.import) };
    });
  },
};

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rare Breeds local play (dev)</title><link rel="stylesheet" href="/play.css"></head><body><div id="root"></div><script src="/play.js"></script></body></html>`;

export async function startServer({ port = 0 } = {}) {
  const ctx = await context({
    entryPoints: { play: path.join(here, "play.tsx") },
    absWorkingDir: sdkRoot, bundle: true, format: "iife", platform: "browser", target: "es2022", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' }, sourcemap: "inline", write: false, outdir: path.join(here, ".out"),
    logLevel: "silent", plugins: [sdkExports],
  });
  let outputs = new Map(), lastError = "";
  async function rebuild() {
    try {
      const result = await ctx.rebuild();
      outputs = new Map(result.outputFiles.map(file => [path.basename(file.path), file.contents]));
      lastError = "";
    } catch (error) {
      lastError = String(error?.message ?? error);
      console.error(lastError);
    }
  }
  await rebuild();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/") {
      const child = url.searchParams.has("child");
      if (!child) await rebuild();
      response.writeHead(lastError ? 500 : 200, { "content-type": "text/html; charset=utf-8", "content-security-policy": child ? CHILD_CSP : PARENT_CSP, "cache-control": "no-store" });
      response.end(lastError ? `<pre>${lastError.replace(/[<&]/g, c => (c === "<" ? "&lt;" : "&amp;"))}</pre>` : html);
      return;
    }
    const name = url.pathname.slice(1);
    const body = outputs.get(name);
    if (!body) { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": name.endsWith(".css") ? "text/css" : "text/javascript", "cache-control": "no-store" });
    response.end(body);
  });
  await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;
  return {
    url,
    get error() { return lastError; },
    async close() { await new Promise(resolve => server.close(resolve)); await ctx.dispose(); },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startServer({ port: Number(process.argv[2] ?? 0) });
  console.log(`Rare Breeds local play: ${server.url}`);
}
