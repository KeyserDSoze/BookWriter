import { defineConfig, type Plugin } from "vitest/config";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// GitHub Pages has no rewrite rules: a deep link such as /worldbuilding gets 404.html, which is the app shell itself.
function spaFallback(): Plugin {
  let outDir = "dist";
  return {
    name: "bookwriter-spa-fallback", apply: "build",
    configResolved(config) { outDir = config.build.outDir; },
    closeBundle() { copyFileSync(join(outDir, "index.html"), join(outDir, "404.html")); },
  };
}

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
// The editorial engine is shared with the personal server and lives OUTSIDE the
// frontend package. Third-party imports of those files resolve to this package's
// node_modules, so there is exactly one copy of zod in every bundle.
const engine = here("../engine/src");

// ghostwriting.ws is a custom apex domain: assets live at "/", not /BookWriter/.
export default defineConfig({
  plugins: [react(), tailwindcss(), spaFallback()],
  base: "/",
  resolve: {
    alias: [
      { find: /^@engine\/(.*)$/, replacement: engine + "/$1" },
      { find: /^zod$/, replacement: here("./node_modules/zod/index.js") },
    ],
  },
  server: { fs: { allow: [here("."), here("../engine")] } },
  test: {
    include: ["src/**/*.test.ts", "../engine/src/**/*.test.ts"],
    setupFiles: ["./src/test/browser-host.ts"],
  },
});
