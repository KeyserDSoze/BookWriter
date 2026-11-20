import { build } from "../frontend/node_modules/esbuild/lib/main.js";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../..", import.meta.url));
// The shared engine lives in src/engine; its third-party imports (zod) resolve to
// the one installed copy, never to a second node_modules.
const shared = {
  alias: { "@engine": "./src/engine/src" },
  nodePaths: [fileURLToPath(new URL("../frontend/node_modules", import.meta.url))],
};
await build({
  absWorkingDir: root, entryPoints: ["src/server/src/main.ts"], outfile: "src/server/dist/server.mjs",
  bundle: true, sourcesContent: false, platform: "node", target: "node22", format: "esm", sourcemap: true,
  define: { "import.meta.env.DEV": "false" }, ...shared,
});
await build({
  absWorkingDir: root, entryPoints: ["src/server/src/cli.ts"], outfile: "src/server/dist/cli.mjs",
  bundle: true, sourcesContent: false, platform: "node", target: "node22", format: "esm", sourcemap: true,
  banner: { js: "#!/usr/bin/env node" }, define: { "import.meta.env.DEV": "false" },
  ...shared,
});
await build({
  absWorkingDir: root, entryPoints: ["src/server/src/testing.ts"], outfile: "src/server/dist/testing.mjs",
  bundle: true, sourcesContent: false, platform: "node", target: "node22", format: "esm", ...shared,
});
