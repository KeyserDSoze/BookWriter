import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { renderUserService, configureAutostart, autostartStatus } from "../dist/testing.mjs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";

const active = { schemaVersion: 1, packageName: "bookwriter-personal-server", version: "0.1.4", activatedAt: "2026-11-20T00:00:00.000Z",
  packageRoot: "/home/user/data/private/npm-runtime/versions/0.1.4", serverPath: "/home/user/data/private/npm-runtime/versions/0.1.4/dist/server.mjs" };

test("systemd unit runs the supervisor CLI with the exact data root", () => {
  const unit = renderUserService(active, "/home/user/BookWriter data");
  assert.match(unit, /WantedBy=default\.target/);
  assert.match(unit, /\/dist\/cli\.mjs" start --data-root "\/home\/user\/BookWriter data"/);
  assert.match(unit, /NoNewPrivileges=true/);
  assert.doesNotMatch(unit, /PAT|token/);
});

test("autostart refuses a root install and accepts only Linux user services", async () => {
  const previous = process.getuid;
  process.getuid = () => 0;
  try { await assert.rejects(configureAutostart(active, "/root/data"), /come root/); }
  finally { process.getuid = previous; }
});

test("status detects only the BookWriter user unit", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "bookwriter-autostart-"));
  try {
    assert.equal(await autostartStatus(root), undefined);
    const path = join(root, ".config", "systemd", "user");
    await fs.mkdir(path, { recursive: true });
    await fs.writeFile(join(path, "bookwriter-personal-server.service"), "[Unit]\n");
    assert.equal(await autostartStatus(root), join(path, "bookwriter-personal-server.service"));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
