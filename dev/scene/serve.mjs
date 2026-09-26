// Dev-only server for the scene harness: bundles dev/scene/harness.ts with esbuild on every request.
// Usage: node dev/scene/serve.mjs            (prints the local URL; PORT=xxxx to pick a port)
import * as esbuild from "esbuild";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sdkRoot = resolve(here, "../..");

export async function startServer({ port = 0 } = {}) {
  const context = await esbuild.context({
    entryPoints: [join(here, "harness.ts")],
    bundle: true, format: "esm", platform: "browser", target: "es2022",
    write: false, sourcemap: "inline", logLevel: "silent", absWorkingDir: sdkRoot,
    plugins: [{
      // The game's accessories module is swapped for dev/scene/accessories-stub.ts (which wraps the real one),
      // so ?hats=1 shows stub hats until the real pixel art exists.
      name: "stub-accessories",
      setup(build) {
        const stub = join(here, "accessories-stub.ts");
        build.onResolve({ filter: /accessories\.ts$/ }, args => args.importer === stub ? undefined : { path: stub });
      },
    }],
  });
  const server = http.createServer(async (request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://127.0.0.1");
    try {
      if (pathname === "/" || pathname === "/index.html") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(await readFile(join(here, "index.html")));
      } else if (pathname === "/harness.js") {
        const result = await context.rebuild();
        response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
        response.end(result.outputFiles[0].contents);
      } else {
        response.writeHead(404); response.end("Not found");
      }
    } catch (error) {
      const message = error?.errors?.map(item => `${item.location?.file}:${item.location?.line} ${item.text}`).join("\n") ?? String(error);
      response.writeHead(500, { "content-type": "text/plain" });
      response.end(message);
      console.error(message);
    }
  });
  await new Promise(done => server.listen(port, "127.0.0.1", done));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/`,
    async close() { await new Promise(done => server.close(done)); await context.dispose(); },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url } = await startServer({ port: Number(process.env.PORT ?? 0) });
  console.log(`Rare Breeds scene harness: ${url}`);
  console.log("Flags: ?babies=5&eggs=3&tier=prismatic&reduced=1&fake=1&clean=1&w=390&chrome=1 (chrome: phone UI stand-ins)");
  console.log("Also: node dev/scene/shoot.mjs [phone ...] (harness checks), node dev/scene/phone.mjs [--reduced] [--aspect \"3 / 4\"] (integrated game on a phone)");
}
