import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// The editorial engine is ONE package (src/engine) used by the browser and by the personal server.
// It reaches storage, locks, credentials and the network only through the HostRuntime port, so it
// can never depend on a browser API, on a Node API, or on the code of either host.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const engine = join(root, "engine/src");
const walk = dir => readdirSync(dir).flatMap(name => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(name) ? [full] : [];
});
function specifiers(file) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  const found = [];
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      found.push(node.moduleSpecifier.text);
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteralLike(node.arguments[0]))
      found.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
const files = walk(engine);
// Packages the engine may use. Anything else (idb, fflate, react, jspdf, docx, node:*) is a host's business.
const ALLOWED_PACKAGES = new Set(["zod", "vitest"]);

test("the engine package exists and its public surface is its own index", () => {
  assert.ok(files.length > 200, "the shared package holds the domain, the runner and the GitHub protocols");
  assert.ok(files.some(file => file.endsWith(join("engine", "src", "index.ts"))));
});

test("no engine file imports from the frontend, the server or a host-only package", () => {
  const offenders = [];
  for (const file of files) for (const spec of specifiers(file)) {
    if (spec.startsWith(".")) {
      const target = resolve(dirname(file), spec);
      if (relative(engine, target).startsWith("..")) offenders.push(`${relative(root, file)} -> ${spec}`);
    } else if (spec.startsWith("@engine/")) continue;
    else if (spec.startsWith("node:") && /\.test\.ts$/.test(file)) continue;
    else if (!ALLOWED_PACKAGES.has(spec.split("/")[0])) offenders.push(`${relative(root, file)} -> ${spec}`);
  }
  assert.deepEqual(offenders, []);
});

test("the engine is compiled without DOM types: a browser global is a compile error, not a convention", () => {
  const config = JSON.parse(readFileSync(join(root, "engine/tsconfig.json"), "utf8"));
  const lib = config.compilerOptions.lib.map(name => name.toLowerCase());
  assert.deepEqual(lib, ["es2022"]);
  assert.equal(config.compilerOptions.strict, true);
});

test("the server is compiled without DOM types either", () => {
  const config = JSON.parse(readFileSync(join(root, "server/tsconfig.json"), "utf8"));
  assert.deepEqual(config.compilerOptions.lib.map(name => name.toLowerCase()), ["es2022"]);
});

test("the server never imports frontend code", () => {
  const offenders = [];
  for (const file of walk(join(root, "server/src"))) for (const spec of specifiers(file))
    if (spec.includes("frontend/src")) offenders.push(`${relative(root, file)} -> ${spec}`);
  assert.deepEqual(offenders, []);
});

test("the frontend reaches the engine only through the @engine alias, never by a relative path", () => {
  const offenders = [];
  for (const file of walk(join(root, "frontend/src"))) for (const spec of specifiers(file))
    if (spec.startsWith(".") && !relative(join(root, "engine"), resolve(dirname(file), spec)).startsWith(".."))
      offenders.push(`${relative(root, file)} -> ${spec}`);
  assert.deepEqual(offenders, []);
});
