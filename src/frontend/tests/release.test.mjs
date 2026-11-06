import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Ogni versione pubblicata compare nel changelog", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const notes = await readFile(new URL("../../../docs/CHANGELOG.md", import.meta.url), "utf8");
  assert.match(notes, new RegExp("^## " + pkg.version.replaceAll(".", "\\.") + " \\u2014", "m"));
});

test("La versione mostrata è derivata dal package.json, mai fissata nel componente", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /import packageInfo from "\.\.\/package\.json"/);
  assert.match(app, /v\{packageInfo\.version\}/);
  assert.doesNotMatch(app, /v0\.3\.0/);
});

test("La pulizia protegge main, PR aperte e HEAD modificate dopo il merge", async () => {
  const workflow = await readFile(new URL("../../../.github/workflows/cleanup-merged-branches.yml", import.meta.url), "utf8");
  assert.match(workflow, /select\(\.merged_at != null\)/);
  assert.match(workflow, /\bstate=open\b/);
  assert.match(workflow, /current_sha.*expected_sha/);
  assert.match(workflow, /\(feat\|fix\|docs\|test\)/);
});

test("Plugin Tailwind e framework restano allineati a versioni esatte", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const core = pkg.devDependencies.tailwindcss;
  const plugin = pkg.devDependencies["@tailwindcss/vite"];
  assert.match(core, /^[0-9]+[.][0-9]+[.][0-9]+$/);
  assert.equal(plugin, core, "Versioni Tailwind e plugin Vite devono essere identiche");
});

test("Non compilare segreti nel frontend", async () => {
  const config = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.doesNotMatch(config, /VITE_(?:PASSWORD|PAT|API_KEY|SECRET)/);
});
