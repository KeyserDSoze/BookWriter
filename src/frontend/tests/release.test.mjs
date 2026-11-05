import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Ogni versione pubblicata compare nel changelog", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const notes = await readFile(new URL("../../../docs/CHANGELOG.md", import.meta.url), "utf8");
  assert.match(notes, new RegExp("^## " + pkg.version.replaceAll(".", "\\.") + " \\u2014", "m"));
});

test("Non compilare segreti nel frontend", async () => {
  const config = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.doesNotMatch(config, /VITE_(?:PASSWORD|PAT|API_KEY|SECRET)/);
});
