import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("PWA: manifest installabile con icone PNG reali", () => {
  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  const sizes = manifest.icons.map(i => i.sizes);
  assert.ok(sizes.includes("192x192") && sizes.includes("512x512"));
  assert.ok(manifest.icons.some(i => i.purpose === "maskable"));
  for (const icon of manifest.icons) {
    const file = new URL(`../public${icon.src}`, import.meta.url);
    assert.ok(existsSync(file), icon.src);
    const png = readFileSync(file);
    assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
    const [w, h] = icon.sizes.split("x").map(Number);
    assert.equal(png.readUInt32BE(16), w);
    assert.equal(png.readUInt32BE(20), h);
  }
});

test("PWA: index.html collega manifest e icone", () => {
  const html = read("index.html");
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon"/);
});

test("PWA: il service worker non intercetta POST né richieste cross-origin", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /request\.method !== "GET"\) return/);
  assert.match(sw, /url\.origin !== self\.location\.origin\) return/);
});

test("PWA: le pagine di ritorno OAuth non diventano la shell offline", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /url\.pathname\.startsWith\("\/oauth\/"\)\) return/);
  assert.match(sw, /fresh\.ok && url\.pathname === "\/"/);
});

test("Percorsi veri: la shell è pubblicata anche come 404.html per i link diretti su GitHub Pages", () => {
  const config = read("vite.config.ts");
  assert.match(config, /copyFileSync\(join\(outDir, "index\.html"\), join\(outDir, "404\.html"\)\)/);
  const html = read("index.html");
  assert.doesNotMatch(html, /href="(?!\/|https?:)[^"#]/); // asset path assoluti: validi a qualunque profondità
  assert.doesNotMatch(html, /src="(?!\/|https?:)[^"#]/);
});
