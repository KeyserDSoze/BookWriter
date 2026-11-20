import { test } from "node:test";
import assert from "node:assert/strict";
import { checkNpmServerRelease, NPM_SERVER_PACKAGE } from "../dist/testing.mjs";

const VERSION = "0.2.0";
function packument(options = {}) {
  const version = options.version ?? VERSION;
  const signed = options.signed !== false;
  return {
    name: NPM_SERVER_PACKAGE, version,
    repository: { type: "git", url: "git+https://github.com/KeyserDSoze/BookWriter.git", directory: "src/server" },
    dist: { integrity: "sha512-" + "A".repeat(60),
      ...(signed ? { signatures: [{ keyid: "SHA256:key", sig: "x".repeat(40) }],
        attestations: { url: `https://registry.npmjs.org/-/npm/v1/attestations/${NPM_SERVER_PACKAGE}@${version}`,
          provenance: { predicateType: "https://slsa.dev/provenance/v1" } } } : {}) },
  };
}

test("latest npm is actionable only for an exact signed and attested version newer than installed", async () => {
  const fetch = async () => Response.json([packument()]);
  assert.deepEqual(await checkNpmServerRelease("0.1.0", fetch), {
    packageName: NPM_SERVER_PACKAGE, installedVersion: "0.1.0", latestVersion: VERSION,
    available: true, canRequest: true, signed: true,
    message: `È disponibile ${VERSION}, pubblicata con firma npm e attestazione di provenienza.`,
  });
});
test("missing registry signature, attestation or published package fail closed", async () => {
  assert.equal((await checkNpmServerRelease("0.1.0", async () => Response.json(packument({ signed: false })))).available, false);
  const foreign = packument(); foreign.dist.attestations.url = "https://example.test/attestation";
  assert.equal((await checkNpmServerRelease("0.1.0", async () => Response.json(foreign))).reason, "no_trusted_release");
  const wrongRepo = packument(); wrongRepo.repository.url = "git+https://github.com/attacker/BookWriter.git";
  assert.equal((await checkNpmServerRelease("0.1.0", async () => Response.json(wrongRepo))).reason, "no_trusted_release");
  assert.equal((await checkNpmServerRelease("0.1.0", async () => new Response("{}", { status: 404 }))).reason, "not_published");
  assert.equal((await checkNpmServerRelease("0.1.0", async () => Response.json({ bad: true }))).reason, "no_trusted_release");
});
test("same version is up to date; a downgrade is never offered", async () => {
  const same = await checkNpmServerRelease(VERSION, async () => Response.json(packument()));
  assert.equal(same.available, false); assert.equal(same.reason, "up_to_date");
  const lower = await checkNpmServerRelease("0.3.0", async () => Response.json(packument()));
  assert.equal(lower.available, false); assert.equal(lower.reason, "up_to_date");
  const metadata = await checkNpmServerRelease("0.2.0+old", async () => Response.json(packument({ version: "0.2.0+new" })));
  assert.equal(metadata.available, false, "build metadata does not create a newer precedence");
  const prerelease = await checkNpmServerRelease("0.2.0-rc.2", async () => Response.json(packument({ version: "0.2.0" })));
  assert.equal(prerelease.available, true, "a final release follows its prerelease");
});
test("unexpected version, redirect or bounded body failure is safe", async () => {
  assert.equal((await checkNpmServerRelease("0.1.0", async () => Response.json(packument({ version: "latest" })))).available, false);
  assert.equal((await checkNpmServerRelease("0.1.0", async () => { throw new TypeError("redirect"); })).available, false);
  assert.equal((await checkNpmServerRelease("0.1.0", async () => new Response("x".repeat(256001)))).available, false);
});

import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { startPersonalServer } from "../dist/testing.mjs";
import { RuntimeInstaller } from "../dist/cli.mjs";

async function temporary(action) {
  const root = await fs.mkdtemp(join(tmpdir(), "bookwriter-npm-api-"));
  try { return await action(root); } finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 }); }
}

test("API advertises and accepts only the exact signed npm version under the CLI supervisor", () => temporary(async root => {
  const service = await startPersonalServer({ root, adminPort: 0, apiPort: 0, git: false });
  const nativeFetch = globalThis.fetch;
  const oldSupervisor = process.env.BOOKWRITER_SUPERVISED;
  process.env.BOOKWRITER_SUPERVISED = "1";
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "registry.npmjs.org") return Response.json(packument());
    return nativeFetch(input, init);
  };
  try {
    const token = await service.auth.issue("Aggiornamenti", ["read", "update"]);
    const base = `http://127.0.0.1:${service.apiPort}`;
    const auth = { apikey: token.token };
    const read = await nativeFetch(base + "/api/v1/updates", { headers: auth });
    assert.equal(read.status, 200);
    const info = await read.json();
    assert.equal(info.available, true); assert.equal(info.canRequest, true); assert.equal(info.latestVersion, VERSION); assert.equal(info.signed, true);
    const update = await nativeFetch(base + "/api/v1/updates", {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ installedVersion: "0.1.3", version: VERSION, confirmed: true }),
    });
    assert.equal(update.status, 202, await update.text());
    const installer = new RuntimeInstaller({ dataRoot: root });
    const request = await installer.readUpdateRequest();
    assert.equal(request.packageName, NPM_SERVER_PACKAGE); assert.equal(request.version, VERSION); assert.equal(request.source, "client");
    assert.doesNotMatch(JSON.stringify(request), /https?:\/\//);
    const old = await nativeFetch(base + "/api/v1/updates", { method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ installedVersion: "0.0.9", version: VERSION, confirmed: true }) });
    assert.equal(old.status, 412);
  } finally {
    globalThis.fetch = nativeFetch;
    if (oldSupervisor === undefined) delete process.env.BOOKWRITER_SUPERVISED; else process.env.BOOKWRITER_SUPERVISED = oldSupervisor;
    await service.close();
  }
}));

test("without the npx supervisor the client sees a version but cannot request a replacement", () => temporary(async root => {
  const service = await startPersonalServer({ root, adminPort: 0, apiPort: 0, git: false });
  const nativeFetch = globalThis.fetch;
  const token = await service.auth.issue("Aggiornamenti", ["read", "update"]);
  delete process.env.BOOKWRITER_SUPERVISED;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    return url.hostname === "registry.npmjs.org" ? Response.json(packument()) : nativeFetch(input, init);
  };
  try {
    const base = `http://127.0.0.1:${service.apiPort}`;
    const read = await nativeFetch(base + "/api/v1/updates", { headers: { apikey: token.token } });
    assert.equal(read.status, 200);
    const info = await read.json(); assert.equal(info.available, true); assert.equal(info.canRequest, false); assert.match(info.message, /npx/);
    const update = await nativeFetch(base + "/api/v1/updates", { method: "POST",
      headers: { apikey: token.token, "Content-Type": "application/json" }, body: JSON.stringify({ installedVersion: "0.1.3", version: VERSION, confirmed: true }) });
    assert.equal(update.status, 409);
  } finally { globalThis.fetch = nativeFetch; await service.close(); }
}));

test("SemVer prerelease order is ASCII and numeric identifiers never pass through floating point", async () => {
  const big = "0.2.0-999999999999999999999999";
  const current = "0.2.0-999999999999999999999998";
  assert.equal((await checkNpmServerRelease(current, async () => Response.json(packument({ version: big })))).available, true);
  assert.equal((await checkNpmServerRelease("0.2.0-B", async () => Response.json(packument({ version: "0.2.0-a" })))).available, true, "ASCII B sorts before a");
});
