import assert from "node:assert/strict";
import { test } from "node:test";

test("BookWriter project skeleton uses strict TypeScript", async () => {
  const { readFile } = await import("node:fs/promises");
  const tsconfig = JSON.parse(await readFile(new URL("../tsconfig.json", import.meta.url), "utf8"));
  assert.equal(tsconfig.compilerOptions.strict, true);
});
