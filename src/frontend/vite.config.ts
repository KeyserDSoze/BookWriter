import { defineConfig, type Plugin } from "vite";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
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

// ghostwriting.ws is a custom apex domain: assets live at "/", not /BookWriter/.
export default defineConfig({
  plugins: [react(), tailwindcss(), spaFallback()],
  base: "/",
});
