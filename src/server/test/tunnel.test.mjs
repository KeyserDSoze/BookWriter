import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CloudflareTunnelManager, lockDataRoot, startPersonalServer } from "../dist/testing.mjs";

async function temporary(action) {
  const base = process.platform === "win32" ? tmpdir() : process.env.BOOKWRITER_TEST_TMP ?? "/tmp/opencode";
  await fs.mkdir(base, { recursive: true, mode: 0o700 });
  const root = await fs.mkdtemp(join(base, "bookwriter-tunnel-test-"));
  try { return await action(root); } finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); }
}

class FakeChild extends EventEmitter {
  constructor(pid, version) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = null;
    this.kills = [];
    this.exited = false;
    if (version) queueMicrotask(() => {
      this.stdout.end(version);
      this.stderr.end();
      this.exitCode = 0;
      this.emit("close", 0, null);
    });
  }
  kill(signal) {
    this.kills.push(signal);
    if (this.exited || this.exitCode !== null) return false;
    this.exited = true;
    this.exitCode = signal === "SIGKILL" ? 137 : 143;
    queueMicrotask(() => {
      this.emit("exit", this.exitCode, signal);
      this.emit("close", this.exitCode, signal);
    });
    return true;
  }
  fail(code = 1, stderr = "") {
    if (this.exited || this.exitCode !== null) return;
    if (stderr) this.stderr.write(stderr);
    this.exited = true;
    this.exitCode = code;
    queueMicrotask(() => this.emit("exit", code, null));
  }
}

function fakeCloudflared({ version = "cloudflared version 2025.4.0 (synthetic)\n", missing = false, detector } = {}) {
  const calls = [];
  const connectors = [];
  let nextPid = 41000;
  const managerOptions = {
    findBinary: async () => missing ? undefined : "/synthetic/cloudflared",
    detectOtherConnectors: detector ?? (async () => []),
    spawn: (command, args, options) => {
      const call = { command, args: [...args], options, child: undefined };
      calls.push(call);
      const child = new FakeChild(nextPid++, args[0] === "--version" ? version : undefined);
      call.child = child;
      if (args[0] === "tunnel") connectors.push(child);
      return child;
    },
  };
  return { managerOptions, calls, connectors, connectorCalls: () => calls.filter(call => call.args[0] === "tunnel") };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test("personal server exposes an unconfigured tunnel in its getter and authenticated admin status", async () => temporary(async root => {
  const release = await lockDataRoot(root);
  const server = await startPersonalServer({ root, adminPort: 0, apiPort: 0, git: false });
  try {
    assert.equal(server.tunnel.configured, false);
    assert.equal(server.tunnel.process, "stopped");
    const adminOrigin = `http://127.0.0.1:${server.adminPort}`;
    const bootstrap = (await fs.readFile(join(root, "private", "admin-bootstrap.txt"), "utf8")).trim();
    const login = await fetch(adminOrigin + "/admin/api/login", {
      method: "POST", headers: { Origin: adminOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ code: bootstrap }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";", 1)[0];
    const status = await (await fetch(adminOrigin + "/admin/api/status", { headers: { Cookie: cookie } })).json();
    assert.equal(status.tunnel.configured, false);
    assert.equal(status.tunnel.process, "stopped");
  } finally { await server.close(); await release(); }
}));

test("configure protects the token file and never exposes the token in state or status", async () => temporary(async root => {
  const fake = fakeCloudflared();
  const manager = new CloudflareTunnelManager({ root, ...fake.managerOptions });
  const token = "synthetic-cloudflare-token-never-public";
  const status = await manager.configure({ token, hostname: "https://bookwriter.example.test" });
  const tokenPath = join(root, "private", "cloudflare-tunnel-token");
  assert.equal(await fs.readFile(tokenPath, "utf8"), token);
  if (process.platform !== "win32") assert.equal((await fs.stat(tokenPath)).mode & 0o777, 0o600);
  const state = await fs.readFile(join(root, "private", "cloudflare-tunnel.json"), "utf8");
  assert.doesNotMatch(state, new RegExp(token));
  assert.doesNotMatch(JSON.stringify(status), new RegExp(token));
  assert.deepEqual(status, {
    enabled: true, configured: true, process: "stopped", binaryAvailable: false,
    otherConnectorDetected: false, hostname: "https://bookwriter.example.test",
  });
}));

test("start uses the exact token-file command, does not put the token in argv/env, and does not respawn after exit", async () => temporary(async root => {
  const fake = fakeCloudflared();
  const manager = new CloudflareTunnelManager({ root, ...fake.managerOptions });
  const token = "synthetic-not-in-command-line";
  await manager.configure({ token });
  const status = await manager.start();
  assert.equal(status.process, "running");
  const [run] = fake.connectorCalls();
  assert.deepEqual(run.args, ["tunnel", "run", "--no-autoupdate", "--token-file", join(root, "private", "cloudflare-tunnel-token")]);
  assert.equal(run.options.shell, false);
  assert.equal(run.options.windowsHide, true);
  assert.doesNotMatch(JSON.stringify(run.args), new RegExp(token));
  assert.doesNotMatch(JSON.stringify(run.options.env), new RegExp(token));
  run.child.fail(1, "Authorization: Bearer synthetic-sensitive-header\n" + token);
  await tick();
  assert.equal(manager.status().process, "failed");
  assert.doesNotMatch(manager.status().lastError, /Authorization|synthetic-sensitive-header|synthetic-not-in-command-line/);
  await tick();
  assert.equal(fake.connectorCalls().length, 1);
}));

test("other connectors are a warning and close, restart and remove kill only BookWriter children", async () => temporary(async root => {
  const foreignPid = 987654;
  const fake = fakeCloudflared({ detector: async () => [foreignPid] });
  const manager = new CloudflareTunnelManager({ root, ...fake.managerOptions });
  await manager.configure({ token: "synthetic-owned-token" });
  const first = await manager.start();
  assert.equal(first.otherConnectorDetected, true);
  assert.equal(first.process, "running");
  const restarted = await manager.restart();
  assert.equal(restarted.process, "running");
  assert.equal(fake.connectors.length, 2);
  assert.deepEqual(fake.connectors[0].kills, ["SIGTERM"]);
  await manager.remove();
  assert.deepEqual(fake.connectors[1].kills, ["SIGTERM"]);
  assert.equal(fake.connectors.some(child => child.kills.includes(foreignPid)), false);
  await manager.close();
  await assert.rejects(fs.readFile(join(root, "private", "cloudflare-tunnel-token")), error => error.code === "ENOENT");
  await assert.rejects(fs.readFile(join(root, "private", "cloudflare-tunnel.json")), error => error.code === "ENOENT");
}));

test("old cloudflared fails only for configured use, and a missing binary never starts a connector", async () => temporary(async root => {
  const old = fakeCloudflared({ version: "cloudflared version 2025.3.9 (synthetic)\n" });
  const oldManager = new CloudflareTunnelManager({ root, ...old.managerOptions });
  await oldManager.configure({ token: "synthetic-old-version-token" });
  const rejected = await oldManager.start();
  assert.equal(rejected.process, "failed");
  assert.equal(rejected.binaryAvailable, true);
  assert.match(rejected.lastError, /2025\.4\.0/);
  assert.equal(old.connectorCalls().length, 0);

  const secondRoot = join(root, "unconfigured");
  await fs.mkdir(secondRoot);
  const unconfigured = fakeCloudflared({ missing: true });
  const serverManager = new CloudflareTunnelManager({ root: secondRoot, ...unconfigured.managerOptions });
  assert.equal((await serverManager.start()).process, "stopped", "unconfigured server remains healthy");
  await serverManager.configure({ token: "synthetic-missing-binary-token" });
  const missing = await serverManager.start();
  assert.equal(missing.process, "failed");
  assert.equal(missing.binaryAvailable, false);
  assert.equal(unconfigured.connectorCalls().length, 0);
}));

test("token rotation stops the old child, waits for an explicit start, and rejects line breaks and NUL", async () => temporary(async root => {
  const fake = fakeCloudflared();
  const manager = new CloudflareTunnelManager({ root, ...fake.managerOptions });
  await manager.configure({ token: "first-synthetic-token" });
  await manager.start();
  const oldChild = fake.connectors[0];
  const rotated = await manager.configure({ token: "second-synthetic-token", hostname: "https://rotated.example.test" });
  assert.deepEqual(oldChild.kills, ["SIGTERM"]);
  assert.equal(rotated.process, "stopped");
  assert.equal(fake.connectors.length, 1, "rotation itself must not spawn a replacement");
  const tokenPath = join(root, "private", "cloudflare-tunnel-token");
  assert.equal(await fs.readFile(tokenPath, "utf8"), "second-synthetic-token");
  await assert.rejects(manager.configure({ token: "bad\nheader" }), /non valido/);
  await assert.rejects(manager.configure({ token: "bad\0token" }), /non valido/);
  assert.equal(await fs.readFile(tokenPath, "utf8"), "second-synthetic-token");
  await manager.start();
  assert.equal(fake.connectors.length, 2);
  fake.connectors[1].stderr.write("Authorization: secret-no-log\n");
  fake.connectors[1].fail(2);
  await tick();
  assert.doesNotMatch(manager.status().lastError ?? "", /secret-no-log/);
}));

test("close is idempotent and invalid persisted state never starts a child", async () => temporary(async root => {
  const fake = fakeCloudflared();
  const manager = new CloudflareTunnelManager({ root, ...fake.managerOptions });
  await manager.configure({ token: "synthetic-close-token" });
  await manager.start();
  await manager.close();
  await manager.close();
  assert.deepEqual(fake.connectors[0].kills, ["SIGTERM"]);

  const invalidRoot = join(root, "invalid");
  await fs.mkdir(join(invalidRoot, "private"), { recursive: true });
  await fs.writeFile(join(invalidRoot, "private", "cloudflare-tunnel.json"), '{"enabled":"yes","token":"leak"}', { mode: 0o600 });
  const invalidFake = fakeCloudflared();
  const invalid = new CloudflareTunnelManager({ root: invalidRoot, ...invalidFake.managerOptions });
  const status = await invalid.start();
  assert.equal(status.process, "failed");
  assert.match(status.lastError, /non è valida/);
  assert.equal(invalidFake.connectorCalls().length, 0);
  assert.doesNotMatch(JSON.stringify(status), /leak/);
}));
