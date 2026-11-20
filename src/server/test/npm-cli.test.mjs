import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  PACKAGE_NAME, RuntimeInstaller, assertExactSemver, defaultDataRoot, parseUpdateRequest,
  sanitizedNpmEnvironment, supervisedChildEnvironment, superviseServer, doctorChecks, isDirectCliInvocation,
  readAdminBootstrap, readBootstrapCodeFile, requestLocalClientToken, rotateLocalAdminBootstrap, setLocalAdminBootstrap,
} from "../dist/cli.mjs";

const here = fileURLToPath(new URL("..", import.meta.url));
async function tempRoot(t) {
  const root = await fs.mkdtemp(join(tmpdir(), "bookwriter-npm-cli-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
function fakeNpm(state = {}) {
  const calls = [];
  const fake = async (command, args, options) => {
    calls.push({ command, args: [...args], options });
    if (args[0] === "view") {
      if (args[1] === PACKAGE_NAME) return { code: 0, stdout: `${JSON.stringify([state.latest ?? "1.2.3"])}\n`, stderr: "" };
      const spec = args[1]; const version = spec.slice(PACKAGE_NAME.length + 1);
      return { code: 0, stdout: JSON.stringify([{ name: PACKAGE_NAME, version,
        repository: { type: "git", url: "git+https://github.com/KeyserDSoze/BookWriter.git", directory: "src/server" },
        dist: { integrity: "sha512-" + "A".repeat(60), signatures: [{ keyid: "SHA256:key", sig: "x".repeat(40) }],
          ...(state.registryOnly ? {} : { attestations: { url: `https://registry.npmjs.org/-/npm/v1/attestations/${PACKAGE_NAME}@${version}`,
            provenance: { predicateType: "https://slsa.dev/provenance/v1" } } }) } }]), stderr: "" };
    }
    if (args[0] === "install") {
      const prefixIndex = args.indexOf("--prefix");
      const prefix = args[prefixIndex + 1];
      const spec = args.find(value => value.startsWith(`${PACKAGE_NAME}@`));
      const version = spec.slice(PACKAGE_NAME.length + 1);
      state.installingVersion = version;
      const packageRoot = join(prefix, "node_modules", PACKAGE_NAME);
      await fs.mkdir(join(packageRoot, "dist"), { recursive: true });
      await fs.writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: PACKAGE_NAME, version }));
      await fs.writeFile(join(packageRoot, "dist", "cli.mjs"), "#!/usr/bin/env node\n");
      await fs.writeFile(join(packageRoot, "dist", "server.mjs"), "export {};\n");
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "audit" && args[1] === "signatures") {
      if (state.failAuditFor === state.installingVersion) return { code: 1, stdout: "", stderr: "unsigned" };
      return { code: 0, stdout: "verified\n", stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "unexpected command" };
  };
  return { calls, runner: fake, state };
}
function request(version = "1.2.3") {
  return {
    schemaVersion: 1, packageName: PACKAGE_NAME, version,
    requestedAt: "2026-11-20T12:00:00.000Z", requestId: "11111111-2222-4333-8444-555555555555", source: "client",
  };
}
async function writeRequest(dataRoot, value = request()) {
  await fs.mkdir(join(dataRoot, "private"), { recursive: true });
  await fs.writeFile(join(dataRoot, "private", "update-request.json"), JSON.stringify(value));
}
function exitedChild() {
  return { kill: () => true, exited: Promise.resolve({ code: 0, signal: null }) };
}

test("semver, default user-local root and sanitized npm environment", () => {
  assert.doesNotThrow(() => assertExactSemver("1.2.3"));
  assert.doesNotThrow(() => assertExactSemver("1.2.3-rc.1"));
  assert.throws(() => assertExactSemver("latest"), /semver/);
  assert.throws(() => assertExactSemver("v1.2.3"), /semver/);
  const root = defaultDataRoot({ HOME: "/home/alice", XDG_DATA_HOME: "/home/alice/data" }, "linux");
  assert.equal(root, "/home/alice/data/bookwriter");
  const env = sanitizedNpmEnvironment({ PATH: "/bin", NPM_TOKEN: "secret", BOOKWRITER_CLOUDFLARE_TOKEN: "secret", HOME: "/home/alice" });
  assert.equal(env.PATH, "/bin");
  assert.equal(env.NPM_CONFIG_IGNORE_SCRIPTS, "true");
  assert.equal(env.NPM_TOKEN, undefined);
  assert.equal(env.BOOKWRITER_CLOUDFLARE_TOKEN, undefined);
  const childEnv = supervisedChildEnvironment({ PATH: "/bin", BOOKWRITER_DATA_ROOT: "/data" });
  assert.deepEqual(childEnv, { PATH: "/bin", BOOKWRITER_SUPERVISED: "1", NPM_CONFIG_UPDATE_NOTIFIER: "false" });
});

test("admin code and client token creation stay loopback, and secrets never become arguments", async t => {
  const root = await tempRoot(t); const privateDir = join(root, "private"); await fs.mkdir(privateDir, { recursive: true });
  await fs.writeFile(join(privateDir, "admin-bootstrap.txt"), "bootstrap-segreto-locale-abbastanza-lungo\n", { mode: 0o600 });
  assert.equal(await readAdminBootstrap(root), "bootstrap-segreto-locale-abbastanza-lungo");
  const customPath = join(privateDir, "custom-code.txt");
  await fs.writeFile(customPath, "codice-scelto-da-autore-lungo-e-privato\n", { mode: 0o600 });
  assert.equal(await readBootstrapCodeFile(customPath), "codice-scelto-da-autore-lungo-e-privato");
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/admin/api/login")) return new Response(JSON.stringify({ csrf: "csrf-locale" }), {
      status: 200, headers: { "set-cookie": "bw_admin=abc; HttpOnly; Secure" } });
    if (url.endsWith("/admin/api/token")) return Response.json({ token: "token-cliente", clientId: "11111111-1111-4111-8111-111111111111" });
    if (url.endsWith("/admin/api/bootstrap/set")) return Response.json({ changed: true });
    return new Response("", { status: 404 });
  };
  await assert.rejects(requestLocalClientToken({ dataRoot: root, label: "Client", scopes: ["read", "admin"], fetchImpl: fakeFetch }), /Permessi/);
  const result = await requestLocalClientToken({ dataRoot: root, label: "Client", scopes: ["read", "write", "run"], fetchImpl: fakeFetch });
  const rotate = async (url, init = {}) => {
    if (url.endsWith("/admin/api/login")) return new Response(JSON.stringify({ csrf: "csrf-rotate" }), {
      status: 200, headers: { "set-cookie": "bw_admin=rotate; HttpOnly; Secure" } });
    return Response.json({ code: "codice-nuovo-locale" });
  };
  assert.equal(await rotateLocalAdminBootstrap({ dataRoot: root, fetchImpl: rotate }), "codice-nuovo-locale");
  const customCode = await readBootstrapCodeFile(customPath);
  await setLocalAdminBootstrap({ dataRoot: root, code: customCode, fetchImpl: fakeFetch });
  const setCall = calls.at(-1);
  assert.equal(setCall.url, "http://127.0.0.1:24105/admin/api/bootstrap/set");
  assert.equal(JSON.parse(setCall.init.body).code, customCode);
  assert.equal(result.token, "token-cliente");
  assert.equal(calls.length, 4); assert.match(calls[0].url, /^http:\/\/127\.0\.0\.1:24105/);
  assert.equal(JSON.parse(calls[0].init.body).code, "bootstrap-segreto-locale-abbastanza-lungo");
  assert.equal(calls[1].init.headers.Cookie, "bw_admin=abc"); assert.equal(calls[1].init.headers["X-CSRF-Token"], "csrf-locale");
  await assert.rejects(requestLocalClientToken({ dataRoot: root, label: "Client", scopes: ["read"], adminOrigin: "https://gw.example.org", fetchImpl: fakeFetch }), /loopback/);
});

test("strict bounded update request schema", async t => {
  const valid = request();
  assert.deepEqual(parseUpdateRequest(valid), valid);
  assert.throws(() => parseUpdateRequest({ ...valid, packageName: "other" }), /aggiornamento/);
  assert.throws(() => parseUpdateRequest({ ...valid, version: "latest" }), /semver/);
  assert.throws(() => parseUpdateRequest({ ...valid, extra: true }), /aggiornamento/);
  const root = await tempRoot(t);
  const installer = new RuntimeInstaller({ dataRoot: root });
  await installer.writeUpdateRequest(valid);
  assert.deepEqual(await installer.readUpdateRequest(), valid);
  const result = {
    schemaVersion: 1, requestId: valid.requestId, state: "failed", version: "1.2.3", fromVersion: "1.2.2",
    at: "2026-11-20T12:01:00.000Z", message: "Aggiornamento non riuscito. La versione attiva precedente resta disponibile.",
  };
  await installer.writeUpdateResult(result);
  assert.deepEqual(await installer.readUpdateResult(), result);
  await assert.rejects(installer.writeUpdateResult({ ...result, message: "errore arbitrario" }), /risultato|Schema/i);
  await fs.writeFile(join(root, "private", "update-request.json"), "x".repeat(20_000));
  await assert.rejects(installer.readUpdateRequest(), /too|grande|limite/i);
});

test("the first 0.1.0 bootstrap accepts the registry signature, never a later update without provenance", async t => {
  const root = await tempRoot(t); const npm = fakeNpm({ registryOnly: true });
  const installer = new RuntimeInstaller({ dataRoot: root, runner: npm.runner, uuid: () => "safe-stage" });
  await assert.rejects(installer.installVersion("0.2.0"), /attestazione|provenienza/);
  const active = await installer.installVersion("0.1.0", { bootstrapRegistryRelease: true });
  assert.equal(active.version, "0.1.0");
  await assert.rejects(installer.installVersion("0.2.0"), /attestazione|provenienza/);
});

test("runtime installation audits signatures before atomic activation", async t => {
  const root = await tempRoot(t);
  const npm = fakeNpm();
  const installer = new RuntimeInstaller({ dataRoot: root, runner: npm.runner, uuid: () => "safe-stage", now: () => new Date("2026-11-20T12:00:00.000Z") });
  const active = await installer.installVersion("1.0.0");
  assert.equal(active.version, "1.0.0");
  assert.deepEqual(npm.calls.slice(0, 3).map(call => call.args[0]), ["view", "install", "audit"]);
  assert.ok(npm.calls[1].args.includes("--ignore-scripts"));
  assert.equal(npm.calls[1].args.some(value => value.startsWith("--registry=")), true);
  assert.equal(npm.calls[2].args.at(-1)?.startsWith("--registry="), true);
  assert.equal(JSON.parse(await fs.readFile(join(root, "private", "npm-install.json"), "utf8")).activeVersion, "1.0.0");
  const state = await installer.installerState();
  assert.deepEqual(state, {
    schemaVersion: 1, packageName: PACKAGE_NAME, channel: "latest", activeVersion: "1.0.0", installedAt: "2026-11-20T12:00:00.000Z",
  });
});

test("audit failure keeps the previous active version and cleans staging", async t => {
  const root = await tempRoot(t);
  const npm = fakeNpm();
  const installer = new RuntimeInstaller({ dataRoot: root, runner: npm.runner, uuid: () => "safe-stage" });
  await installer.installVersion("1.0.0");
  npm.state.failAuditFor = "2.0.0";
  await assert.rejects(installer.installVersion("2.0.0"), /npm non riuscita/);
  assert.equal((await installer.activeRuntime()).version, "1.0.0");
  await assert.rejects(fs.stat(join(root, "private", "npm-runtime", "versions", "2.0.0")), /ENOENT/);
  await assert.rejects(fs.stat(join(root, "private", "npm-runtime", "staging-safe-stage")), /ENOENT/);
});

test("an existing version is never reactivated if its bytes differ from the freshly audited package", async t => {
  const root = await tempRoot(t); const npm = fakeNpm();
  const installer = new RuntimeInstaller({ dataRoot: root, runner: npm.runner, uuid: () => "safe-stage" });
  await installer.installVersion("1.0.0");
  const activePath = join(root, "private", "npm-runtime", "versions", "1.0.0", "dist", "server.mjs");
  await fs.writeFile(activePath, "evil\n");
  await assert.rejects(installer.installVersion("1.0.0"), /diverso dal pacchetto/);
  assert.equal(await fs.readFile(activePath, "utf8"), "evil\n");
});

test("supervisor observes a request while the child is running and stops only that child", async t => {
  const root = await tempRoot(t); const npm = fakeNpm();
  const installer = new RuntimeInstaller({ dataRoot: root, runner: npm.runner, uuid: () => "safe-stage" });
  await installer.installVersion("1.0.0");
  let resolveExit; let signalKill;
  const first = { kill: signal => { signalKill = signal; resolveExit({ code: 0, signal: null }); return true; },
    exited: new Promise(done => { resolveExit = done; }) };
  let starts = 0; let announce; const started = new Promise(done => { announce = done; });
  const running = superviseServer({ installer, currentVersion: "1.0.0", pollMs: 1, stopTimeoutMs: 100, forwardSignals: false,
    spawnChild: () => { starts++; if (starts === 1) { announce(); return first; } return exitedChild(); } });
  await started;
  await new Promise(resolve => setTimeout(resolve, 5));
  await installer.writeUpdateRequest(request("2.0.0"));
  await Promise.race([running, new Promise((_, reject) => setTimeout(() => reject(new Error("supervisor stuck")), 1000))]);
  assert.equal(signalKill, "SIGTERM"); assert.equal(starts, 2); assert.equal((await installer.activeRuntime()).version, "2.0.0");
  assert.equal((await installer.readUpdateResult()).state, "completed");
});

test("supervisor activates a requested exact version, writes result and removes only that request", async t => {
  const root = await tempRoot(t);
  const npm = fakeNpm();
  const installer = new RuntimeInstaller({ dataRoot: root, runner: npm.runner, uuid: () => "safe-stage" });
  await installer.installVersion("1.0.0");
  const valid = request("2.0.0");
  await writeRequest(root, valid);
  const first = exitedChild();
  let starts = 0; const paths = [];
  const exit = await superviseServer({
    installer, currentVersion: "1.0.0", pollMs: 1, stopTimeoutMs: 100, forwardSignals: false,
    spawnChild: (serverPath) => {
      starts++; paths.push(serverPath);
      if (starts === 1) return first;
      return { kill: () => true, exited: Promise.resolve({ code: 0, signal: null }) };
    },
  });
  assert.equal(exit.code, 0);
  assert.equal(starts, 2);
  assert.equal((await installer.activeRuntime()).version, "2.0.0");
  await assert.rejects(fs.stat(join(root, "private", "update-request.json")), /ENOENT/);
  const result = JSON.parse(await fs.readFile(join(root, "private", "update-result.json"), "utf8"));
  assert.equal(result.state, "completed"); assert.equal(result.requestId, valid.requestId); assert.equal(result.fromVersion, "1.0.0");
  assert.ok(paths[0].endsWith(join("1.0.0", "dist", "server.mjs")));
  assert.ok(paths[1].endsWith(join("2.0.0", "dist", "server.mjs")));
});

test("supervisor applies at most three update restarts per supervisor hour", async t => {
  const root = await tempRoot(t);
  const npm = fakeNpm();
  const installer = new RuntimeInstaller({ dataRoot: root, runner: npm.runner, uuid: () => "safe-stage" });
  await installer.installVersion("1.0.0");
  const versions = ["1.1.0", "1.2.0", "1.3.0", "1.4.0"];
  let starts = 0;
  const exit = await superviseServer({
    installer, currentVersion: "1.0.0", forwardSignals: false, hourMs: 60_000,
    spawnChild: () => {
      const version = versions[starts++];
      const handle = exitedChild();
      if (version) writeFileSync(join(root, "private", "update-request.json"), JSON.stringify({
        ...request(version), requestId: `22222222-2222-4222-8222-${String(starts).padStart(12, "2")}`,
      }));
      return handle;
    },
  });
  assert.equal(exit.code, 0);
  assert.equal(starts, 5);
  assert.equal((await installer.activeRuntime()).version, "1.3.0");
  const result = await installer.readUpdateResult();
  assert.equal(result.state, "failed");
  assert.equal(result.version, "1.4.0");
  assert.match(result.message, /tre aggiornamenti/);
  assert.equal((await installer.readUpdateRequest()).version, "1.4.0");
});

test("supervisor preserves active runtime and request when signature audit fails", async t => {
  const root = await tempRoot(t);
  const npm = fakeNpm();
  const installer = new RuntimeInstaller({ dataRoot: root, runner: npm.runner, uuid: () => "safe-stage" });
  await installer.installVersion("1.0.0");
  npm.state.failAuditFor = "2.0.0";
  const valid = request("2.0.0"); await writeRequest(root, valid);
  const first = exitedChild(); let starts = 0;
  await superviseServer({
    installer, currentVersion: "1.0.0", pollMs: 1, stopTimeoutMs: 100, forwardSignals: false,
    spawnChild: () => starts++ === 0 ? first : { kill: () => true, exited: Promise.resolve({ code: 0, signal: null }) },
  });
  assert.equal((await installer.activeRuntime()).version, "1.0.0");
  assert.deepEqual(await installer.readUpdateRequest(), valid);
  const result = JSON.parse(await fs.readFile(join(root, "private", "update-result.json"), "utf8"));
  assert.equal(result.state, "failed");
  assert.equal(result.message, "Aggiornamento non riuscito. La versione attiva precedente resta disponibile.");
  assert.equal(starts, 2);
});

test("npm .bin symlink is recognised as the direct CLI entry point", async t => {
  if (process.platform === "win32") return;
  const root = await tempRoot(t), target = join(root, "cli.mjs"), link = join(root, "bookwriter-server");
  await fs.writeFile(target, "#!/usr/bin/env node\n"); await fs.symlink(target, link);
  assert.equal(isDirectCliInvocation(new URL("file://" + target).href, link), true);
  assert.equal(isDirectCliInvocation(new URL("file://" + target).href, join(root, "other.mjs")), false);
});

test("published package metadata, workflow and CLI package are intentionally narrow", () => {
  const packageJson = JSON.parse(spawnSync(process.execPath, ["-e", `process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(join(here, "package.json"))},'utf8'))`], { encoding: "utf8" }).stdout);
  assert.equal(packageJson.name, PACKAGE_NAME);
  assert.equal(packageJson.private, undefined);
  assert.equal(packageJson.engines.node, ">=22.14.0");
  assert.equal(packageJson.bin["bookwriter-server"], "dist/cli.mjs");
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.publishConfig.access, "public");
  assert.deepEqual(packageJson.files, ["dist/cli.mjs", "dist/server.mjs", "dist/cli.mjs.map", "dist/server.mjs.map", "README.md"]);
  const help = spawnSync(process.execPath, [join(here, "dist", "cli.mjs"), "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /setup/); assert.match(help.stdout, /doctor/);
  const doctorRoot = spawnSync(process.execPath, [join(here, "dist", "cli.mjs"), "doctor", "--data-root", "/percorso"], { encoding: "utf8" });
  assert.notEqual(doctorRoot.status, 2, "--data-root belongs to status/doctor too");
  const badPort = spawnSync(process.execPath, [join(here, "dist", "cli.mjs"), "start", "--port", "1234"], { encoding: "utf8" });
  assert.equal(badPort.status, 2);
});
