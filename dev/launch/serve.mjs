// Dev-only server for the Moon Slingshot flight harness: bundles dev/launch/harness.ts with esbuild on every request.
// Usage: node dev/launch/serve.mjs            (port 4321; PORT=xxxx to pick another, PORT=0 for any free port)
import * as esbuild from "esbuild";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sdkRoot = resolve(here, "../..");

export async function startServer({ port = 4321 } = {}) {
  const context = await esbuild.context({
    entryPoints: [join(here, "harness.ts")],
    bundle: true, format: "esm", platform: "browser", target: "es2022",
    write: false, sourcemap: "inline", logLevel: "silent", absWorkingDir: sdkRoot,
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
  const { url } = await startServer({ port: Number(process.env.PORT ?? 4321) });
  console.log(`Moon Slingshot flight harness: ${url}`);
  console.log("Flags: ?zone=moon&pull=0.8&tier=prismatic&hat=crown&reduced=1&w=390&clean=1&auto=1 (auto: play on load)");
  console.log("Also: node dev/launch/shoot.mjs [zones] [phone] [skip] [reduced] [perf]   (screenshots in dev/launch/shots)");
}
