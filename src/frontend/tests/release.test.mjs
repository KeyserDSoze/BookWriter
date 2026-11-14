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
  assert.ok(workflow.includes("(feat|fix|docs|test|chore)"));
  assert.ok(workflow.includes('legacy_sha="55b2142c6c6674e9d309af2da7b8b8df35850207"'));
  assert.ok(workflow.includes('"$legacy_current" == "$legacy_sha"'));
  assert.ok(workflow.includes("pulls/50"));
  assert.ok(workflow.includes("narrative-event-decisions.ts?ref=main"));
  assert.ok(workflow.includes('grep -Fxq -- "$legacy_branch"'));
});

test("Plugin Tailwind e framework restano allineati a versioni esatte", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const core = pkg.devDependencies.tailwindcss;
  const plugin = pkg.devDependencies["@tailwindcss/vite"];
  assert.match(core, /^[0-9]+[.][0-9]+[.][0-9]+$/);
  assert.equal(plugin, core, "Versioni Tailwind e plugin Vite devono essere identiche");
});

test("Lockfile npm reale e coerente con il manifest e le dipendenze dirette", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].name, pkg.name);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.deepEqual(lock.packages[""].dependencies, pkg.dependencies);
  assert.deepEqual(lock.packages[""].devDependencies, pkg.devDependencies);
  for (const [name, spec] of Object.entries({...pkg.dependencies, ...pkg.devDependencies})) {
    const installed = lock.packages["node_modules/" + name];
    assert.ok(installed, "Dipendenza diretta non bloccata nel lock: " + name);
    if (/^[0-9]+[.][0-9]+[.][0-9]+$/.test(spec))
      assert.equal(installed.version, spec, "Versione esatta non rispettata: " + name);
  }
  assert.equal(lock.packages["node_modules/tailwindcss"].version,
    lock.packages["node_modules/@tailwindcss/vite"].version);
  assert.ok(Object.keys(lock.packages).length > 100, "Lockfile npm non generato realmente");
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path || !entry.resolved) continue;
    const resolved = new URL(entry.resolved);
    assert.equal(resolved.protocol, "https:", "Riferimento non HTTPS nel lock: " + path);
    if (resolved.hostname === "registry.npmjs.org")
      assert.match(entry.integrity ?? "", /^sha(?:512|1|256|384)-[A-Za-z0-9+/=]+$/,
        "Integrità npm mancante: " + path);
  }
});

test("CI e Pages richiedono npm ci anziché risoluzioni dinamiche", async () => {
  for (const path of ["ci.yml", "pages.yml"]) {
    const workflow = await readFile(
      new URL("../../../.github/workflows/" + path, import.meta.url), "utf8");
    assert.match(workflow, /run: npm ci --no-audit --no-fund/);
    assert.doesNotMatch(workflow, /run: npm install/);
    assert.match(workflow, /git diff --exit-code -- package-lock.json/);
  }
});

test("Tutti i rewind storici riaprono anche la catena di rivalidazione", async () => {
  const names = [
    "historical-research", "historical-bibliography", "archival-catalog",
    "institutional-inspection", "loc-iiif", "loc-ocr",
    "loc-ocr-audit", "loc-scan-collation", "manual-evidence",
    "wikisource-research", "wikisource-audit", "historical-source-relations",
  ];
  for (const name of names) {
    const source = await readFile(new URL("../src/application/" + name + ".ts",
      import.meta.url), "utf8");
    assert.match(source, /import \{ markHistoricalEvidenceChanged \} from/);
    assert.match(source, /if\s*\((?:reopen|reopened|restart)\)\s*\{\s*markHistoricalEvidenceChanged\(book,\s*(?:target|chapter)\);/,
      "Rivalidazione mancante nel rewind storico: " + name);
    assert.match(source, /synopsisBeforeChapter/);
    assert.match(source, /outbox/);
  }
});

test("Non compilare segreti nel frontend", async () => {
  const config = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.doesNotMatch(config, /VITE_(?:PASSWORD|PAT|API_KEY|SECRET)/);
});

test("Gli identificativi OAuth pubblici arrivano da variabili del repository, mai da secret", async () => {
  const pages = await readFile(new URL("../../../.github/workflows/pages.yml", import.meta.url), "utf8");
  for (const [name, variable] of [["VITE_GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_ID"],
    ["VITE_MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_ID"], ["VITE_MICROSOFT_TENANT", "MICROSOFT_TENANT"]])
    assert.ok(pages.includes(`${name}: \${{ vars.${variable} }}`), "Variabile pubblica mancante nel workflow Pages: " + name);
  assert.doesNotMatch(pages, /secrets\.(?:GOOGLE|MICROSOFT)/i);
  assert.doesNotMatch(pages, /VITE_[A-Z_]*(?:SECRET|PASSWORD|TOKEN)/);
});

test("Nessun client secret nel codice del cloud e pagina di ritorno OAuth minimale", async () => {
  const { readdir } = await import("node:fs/promises");
  const directory = new URL("../src/infrastructure/cloud/", import.meta.url);
  for (const file of await readdir(directory)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    assert.doesNotMatch(await readFile(new URL(file, directory), "utf8"), /client_secret/i, "client_secret in " + file);
  }
  const callback = await readFile(new URL("../public/oauth/microsoft.html", import.meta.url), "utf8");
  assert.match(callback, /postMessage\(message, window\.location\.origin\)/);
  assert.doesNotMatch(callback, /postMessage\([^)]*["']\*["']/);
  assert.doesNotMatch(callback, /client_secret|localStorage|sessionStorage|fetch\(/i);
});

test("La guida STE-100 contiene gli stessi valori usati dal codice", async () => {
  const guide = await readFile(new URL("../../../docs/cloud-app-registration-ste100.md", import.meta.url), "utf8");
  const microsoft = await readFile(new URL("../src/infrastructure/cloud/microsoft-graph.ts", import.meta.url), "utf8");
  const google = await readFile(new URL("../src/infrastructure/cloud/google-drive.ts", import.meta.url), "utf8");
  const callbackPath = /MICROSOFT_CALLBACK_PATH = "([^"]+)"/.exec(microsoft)?.[1];
  const driveScope = /GOOGLE_DRIVE_SCOPE = "([^"]+)"/.exec(google)?.[1];
  assert.ok(callbackPath && driveScope, "Costanti del codice non trovate");
  for (const value of [callbackPath, driveScope, "Files.ReadWrite.AppFolder", "offline_access",
    "https://ghostwriting.ws", "http://localhost:5173", "GOOGLE_CLIENT_ID", "MICROSOFT_CLIENT_ID", "Single-page application"])
    assert.ok(guide.includes(value), "La guida non riporta: " + value);
  assert.match(guide, /ASD-STE100/);
});
