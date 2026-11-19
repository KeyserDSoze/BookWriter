import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { GitWorkspaces, buildGitEnvironment, invalidTreePath } from "../dist/testing.mjs";

const NETWORK = "GitHub non raggiungibile. Controlla rete e autorizzazioni del browser.";
const SENTINEL = "ghp_SENTINEL0123456789abcdefghijklmnopqr";
const REPO = "/repos/acme/book";
const probed = await GitWorkspaces.probe().then(value => value, error => error);
const skip = probed instanceof Error ? "git non disponibile: " + probed.message : false;
const posix = process.platform !== "win32";

async function temporary(action) {
  const base = process.platform === "win32" ? tmpdir() : process.env.BOOKWRITER_TEST_TMP ?? "/tmp/opencode";
  await fs.mkdir(base, { recursive: true, mode: 0o700 });
  const root = await fs.mkdtemp(join(base, "bookwriter-git-"));
  try { return await action(root); } finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); }
}

/** Plain git for the test's own "other device" and for inspection, never through the transport. */
function plain(cwd, args, extra = {}) {
  return execFileSync("git", args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(tmpdir(), "bookwriter-test-gitconfig-absent"),
      GIT_AUTHOR_NAME: "Altro dispositivo", GIT_AUTHOR_EMAIL: "altro@example.invalid",
      GIT_COMMITTER_NAME: "Altro dispositivo", GIT_COMMITTER_EMAIL: "altro@example.invalid", ...extra,
    },
  }).trim();
}
const inspect = (workspace, args) => plain(workspace, args, { GIT_DIR: join(workspace, ".git"), GIT_WORK_TREE: workspace });

async function fixture(root, options = {}) {
  const bare = join(root, "origin.git");
  plain(root, ["init", "--bare", "-q", "-b", "main", bare]);
  const other = join(root, "other");
  plain(root, ["init", "-q", "-b", "main", other]);
  plain(other, ["remote", "add", "origin", pathToFileURL(bare).href]);
  const device = {
    bare, other,
    async commit(files, message = "altro dispositivo", branch = "main", remove = []) {
      for (const [path, content] of Object.entries(files)) {
        await fs.mkdir(join(other, path, ".."), { recursive: true });
        await fs.writeFile(join(other, path), content);
      }
      for (const path of remove) await fs.rm(join(other, path), { force: true });
      plain(other, ["add", "-A"]);
      plain(other, ["commit", "-q", "-m", message]);
      plain(other, ["push", "-q", "origin", "HEAD:refs/heads/" + branch]);
      return plain(other, ["rev-parse", "HEAD"]);
    },
  };
  const first = await device.commit({
    "book.md": "# Libro\n", ".bookwriter/project.json": "{\"a\":1}\n",
    "chapters/001-uno/chapter.md": "Capitolo\n", "chapters/001-uno/001-scena con spazi è.md": "Testo della scena\n",
  }, "primo");
  const workspaces = new GitWorkspaces({
    root: join(root, "server"), urlFor: () => pathToFileURL(bare).href, allowFileProtocol: true, ...options,
  });
  const api = async (method, suffix, body) => {
    const result = await workspaces.transport.handle({ token: SENTINEL, method, path: REPO + suffix, body });
    return result ?? { status: undefined, json: undefined };
  };
  return { ...device, first, workspaces, api, workspace: () => workspaces.workspacePath("acme", "book") };
}
const refSha = async (f, branch = "main") => (await f.api("GET", "/git/ref/heads/" + branch)).json?.object?.sha;
async function publish(f, head, entries, message = "bookwriter: sync 11111111-1111-4111-8111-111111111111", extraParents = []) {
  const commit = await f.api("GET", "/git/commits/" + head);
  const tree = await f.api("POST", "/git/trees", { base_tree: commit.json.tree.sha, tree: entries });
  assert.equal(tree.status, 201, JSON.stringify(tree.json));
  const made = await f.api("POST", "/git/commits", { message, tree: tree.json.sha, parents: [head, ...extraParents] });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  return { tree: tree.json.sha, commit: made.json.sha };
}
const blob = (path, content) => ({ path, mode: "100644", type: "blob", content });
const drop = path => ({ path, mode: "100644", type: "blob", sha: null });

async function walk(dir) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path)); else if (entry.isFile()) files.push(path);
  }
  return files;
}

test("probe reports the git version and fails clearly without git", async () => {
  await assert.rejects(GitWorkspaces.probe("bookwriter-git-che-non-esiste"), /Git non trovato/);
  if (skip) return;
  assert.match(probed.version, /^\d+\.\d+/);
});

test("probe rejects a git older than the supported one", { skip: skip || !posix && "serve uno script eseguibile" }, async () => temporary(async root => {
  const fake = join(root, "old-git");
  await fs.writeFile(fake, "#!/bin/sh\necho 'git version 2.20.1'\n", { mode: 0o755 });
  await assert.rejects(GitWorkspaces.probe(fake), /troppo vecchio/);
}));

test("environment is built from scratch with auth only as env config", () => {
  const input = { home: join(tmpdir(), "h"), hooksDir: join(tmpdir(), "h", "hooks"), configFile: join(tmpdir(), "h", "cfg"), allowFileProtocol: false };
  process.env.BOOKWRITER_TEST_SECRET = "server-secret";
  try {
    const bare = buildGitEnvironment(input);
    assert.equal(bare.BOOKWRITER_TEST_SECRET, undefined);
    assert.equal(bare.GIT_ALLOW_PROTOCOL, "https");
    assert.equal(bare.GIT_TERMINAL_PROMPT, "0");
    assert.equal(bare.GIT_CONFIG_NOSYSTEM, "1");
    assert.equal(bare.GIT_ASKPASS, "");
    assert.equal(bare.HOME, input.home);
    const pairs = Object.fromEntries(Array.from({ length: Number(bare.GIT_CONFIG_COUNT) }, (_, n) => [bare["GIT_CONFIG_KEY_" + n], bare["GIT_CONFIG_VALUE_" + n]]));
    assert.deepEqual(Object.keys(pairs).filter(key => key.includes("extraheader")), []);
    for (const [key, value] of [["core.hooksPath", input.hooksDir], ["credential.helper", ""], ["http.followRedirects", "false"],
      ["core.symlinks", "false"], ["core.autocrlf", "false"], ["core.fsmonitor", "false"], ["core.protectNTFS", "true"],
      ["fetch.fsckObjects", "true"], ["transfer.fsckObjects", "true"], ["gc.auto", "0"], ["maintenance.auto", "false"],
      ["submodule.recurse", "false"], ["protocol.version", "2"]]) assert.equal(pairs[key], value, key);
    assert.equal(buildGitEnvironment({ ...input, allowFileProtocol: true }).GIT_ALLOW_PROTOCOL, "https:file");

    const authed = buildGitEnvironment({ ...input, token: SENTINEL });
    const header = Object.entries(authed).find(([, value]) => value.startsWith("Authorization: Basic "));
    assert.ok(header);
    assert.equal(Buffer.from(header[1].slice(21), "base64").toString("utf8"), "x-access-token:" + SENTINEL);
    const elsewhere = Object.entries(authed).filter(([, value]) => value !== header[1]).map(([, value]) => value).join("\n");
    assert.ok(!elsewhere.includes(SENTINEL));
    assert.throws(() => buildGitEnvironment({ ...input, token: "bad\ntoken" + SENTINEL }), error => !error.message.includes(SENTINEL));
  } finally { delete process.env.BOOKWRITER_TEST_SECRET; }
});

const FORWARDED = {
  HTTPS_PROXY: "http://proxyuser:proxysecret@proxy.invalid:3128", https_proxy: "http://proxyuser:proxysecret@proxy.invalid:3128",
  HTTP_PROXY: "http://proxy.invalid:3128", http_proxy: "http://proxy.invalid:3128",
  ALL_PROXY: "socks5://proxy.invalid:1080", all_proxy: "socks5://proxy.invalid:1080",
  NO_PROXY: "localhost,.internal", no_proxy: "localhost,.internal",
  SSL_CERT_FILE: "/etc/bookwriter/ca.pem", SSL_CERT_DIR: "/etc/bookwriter/certs",
  GIT_SSL_CAINFO: "/etc/bookwriter/ca.pem", GIT_SSL_CAPATH: "/etc/bookwriter/certs",
};
const NOT_FORWARDED = {
  SECRET_SENTINEL: "secret-must-not-leak", GITHUB_TOKEN: "ghp_token_must_not_leak", GH_TOKEN: "gh-token-must-not-leak",
  GIT_SSL_NO_VERIFY: "1", GIT_TRACE: "1", GIT_ASKPASS: "/nonexistent/evil-askpass",
};
async function withEnvironment(values, action) {
  const previous = Object.entries(values).map(([name]) => [name, process.env[name]]);
  Object.assign(process.env, values);
  try { return await action(); } finally {
    for (const [name, value] of previous.reverse()) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
}

test("proxy and CA variables are copied from an explicit allowlist only, and only when asked", () => withEnvironment({ ...FORWARDED, ...NOT_FORWARDED }, () => {
  const input = { home: join(tmpdir(), "h"), hooksDir: join(tmpdir(), "h", "hooks"), configFile: join(tmpdir(), "h", "cfg"), allowFileProtocol: false };
  const bare = buildGitEnvironment(input);
  for (const name of Object.keys(FORWARDED)) assert.equal(bare[name], undefined, name);
  assert.deepEqual(Object.keys(buildGitEnvironment({ ...input, forwardNetwork: false })).sort(), Object.keys(bare).sort());
  const forwarded = buildGitEnvironment({ ...input, forwardNetwork: true });
  for (const [name, value] of Object.entries(FORWARDED)) assert.equal(forwarded[name], value, name);
  assert.deepEqual(Object.keys(forwarded).filter(name => !(name in bare)).sort(), Object.keys(FORWARDED).sort());
  for (const name of ["SECRET_SENTINEL", "GITHUB_TOKEN", "GH_TOKEN", "GIT_SSL_NO_VERIFY", "GIT_TRACE"]) assert.equal(forwarded[name], undefined, name);
  assert.equal(forwarded.GIT_ASKPASS, "");
  assert.ok(!Object.values(forwarded).some(value => /must-not-leak|must_not_leak/.test(value)));
}));

test("tree path validation", () => {
  for (const path of ["a/../b", "..", ".", "/abs", "a\\b", "a//b", "a/", ".git", ".git/config", ".GIT/x", "a/.Git", ".git ", ".git.", "GIT~1/x",
    "x\u0000y", "x\ny", "x".repeat(401), "", 7, undefined, ".\u200cgit/x", "lone\ud800"])
    assert.equal(invalidTreePath(path), true, String(path));
  for (const path of ["book.md", ".bookwriter/project.json", "chapters/001-uno/001-scena con spazi è.md", "capitolo/日本語.md", ".github/x", ".gitignore", "a/b/c.md"])
    assert.equal(invalidTreePath(path), false, path);
});

test("reads: ref, commit, tree, blob, contents and commit list", { skip }, async () => temporary(async root => {
  const f = await fixture(root);
  const second = await f.commit({ "book.md": "# Libro 2\n" }, "secondo");
  const head = await refSha(f);
  assert.equal(head, second);
  assert.deepEqual((await f.api("GET", "/git/ref/heads/main")).json, { ref: "refs/heads/main", object: { type: "commit", sha: second } });
  assert.equal((await f.api("GET", "/git/ref/heads/inesistente")).status, 404);
  assert.equal((await f.api("GET", "/git/ref/heads/a..b")).status, 404);

  const commit = (await f.api("GET", "/git/commits/" + head)).json;
  assert.equal(commit.sha, head);
  assert.equal(commit.message, "secondo\n");
  assert.deepEqual(commit.parents, [{ sha: f.first }]);
  assert.equal(commit.tree.sha, plain(f.other, ["rev-parse", head + "^{tree}"]));
  assert.equal((await f.api("GET", "/git/commits/" + "0".repeat(40))).status, 404);
  assert.equal((await f.api("GET", "/git/commits/main")).status, 404);

  const tree = (await f.api("GET", "/git/trees/" + head + "?recursive=1")).json;
  assert.equal(tree.sha, commit.tree.sha);
  assert.equal(tree.truncated, false);
  const expected = plain(f.other, ["ls-tree", "-r", "-t", "--name-only", "-z", head]).split("\0").filter(Boolean).sort();
  assert.deepEqual(tree.tree.map(entry => entry.path).sort(), expected);
  for (const entry of tree.tree) {
    assert.match(entry.sha, /^[0-9a-f]{40}$/);
    assert.ok(["blob", "tree"].includes(entry.type));
    assert.equal(typeof entry.mode, "string");
    if (entry.type === "blob") assert.equal(typeof entry.size, "number");
  }
  const scene = tree.tree.find(entry => entry.path === "chapters/001-uno/001-scena con spazi è.md");
  assert.equal(scene.size, Buffer.byteLength("Testo della scena\n"));
  const shallow = (await f.api("GET", "/git/trees/main")).json;
  assert.ok(shallow.tree.every(entry => !entry.path.includes("/")));

  const blobResult = (await f.api("GET", "/git/blobs/" + scene.sha)).json;
  assert.equal(blobResult.encoding, "base64");
  assert.equal(Buffer.from(blobResult.content, "base64").toString("utf8"), "Testo della scena\n");
  assert.equal(blobResult.size, scene.size);
  assert.equal((await f.api("GET", "/git/blobs/" + "1".repeat(40))).status, 404);

  const file = (await f.api("GET", "/contents/chapters/001-uno/001-scena%20con%20spazi%20%C3%A8.md?ref=" + head)).json;
  assert.equal(file.type, "file");
  assert.equal(file.encoding, "base64");
  assert.equal(file.sha, scene.sha);
  assert.equal(Buffer.from(file.content, "base64").toString("utf8"), "Testo della scena\n");
  const byBranch = (await f.api("GET", "/contents/book.md?ref=main")).json;
  assert.equal(Buffer.from(byBranch.content, "base64").toString("utf8"), "# Libro 2\n");
  const old = (await f.api("GET", "/contents/book.md?ref=" + f.first)).json;
  assert.equal(Buffer.from(old.content, "base64").toString("utf8"), "# Libro\n");
  const directory = (await f.api("GET", "/contents/chapters/001-uno?ref=" + head)).json;
  assert.deepEqual(directory.map(entry => entry.path).sort(), ["chapters/001-uno/001-scena con spazi è.md", "chapters/001-uno/chapter.md"]);
  assert.ok(directory.every(entry => entry.type === "file"));
  const root0 = (await f.api("GET", "/contents?ref=" + head)).json;
  assert.ok(root0.some(entry => entry.path === "chapters" && entry.type === "dir"));
  assert.equal((await f.api("GET", "/contents/manca.md?ref=" + head)).status, 404);
  assert.equal((await f.api("GET", "/contents/a%2F..%2Fbook.md?ref=" + head)).status, 422);
  assert.equal((await f.api("GET", "/contents/book.md?ref=" + "2".repeat(40))).status, 404);
  assert.equal((await f.api("GET", "/contents/book.md?ref=nessun-ramo")).status, 404);

  const list = (await f.api("GET", "/commits?sha=" + head + "&per_page=100&page=1")).json;
  assert.deepEqual(list, [{ sha: head }, { sha: f.first }]);
  assert.deepEqual((await f.api("GET", "/commits?sha=" + head + "&per_page=1&page=2")).json, [{ sha: f.first }]);
  assert.deepEqual((await f.api("GET", "/commits?sha=" + head + "&per_page=1&page=3")).json, []);
  assert.equal((await f.api("GET", "/commits?sha=" + head + "&per_page=x")).status, 422);
}));

test("a commit pushed by another device is seen by the next read and fetched by SHA", { skip }, async () => temporary(async root => {
  const f = await fixture(root);
  assert.equal(await refSha(f), f.first);
  const second = await f.commit({ "nuovo.md": "arrivato\n" }, "da un altro dispositivo");
  assert.equal(await refSha(f), second);
  const content = (await f.api("GET", "/contents/nuovo.md?ref=" + second)).json;
  assert.equal(Buffer.from(content.content, "base64").toString("utf8"), "arrivato\n");
  // A commit on another branch, never read before, is fetched when asked for by SHA.
  const side = await f.commit({ "laterale.md": "solo qui\n" }, "ramo laterale", "side");
  const sideFile = await f.api("GET", "/contents/laterale.md?ref=" + side);
  assert.equal(sideFile.status, 200);
  assert.equal((await f.api("GET", "/git/commits/" + side)).json.message, "ramo laterale\n");
}));

test("tree, commit and fast-forward PATCH: remote, history and working folder", { skip }, async () => temporary(async root => {
  const f = await fixture(root);
  const head = await refSha(f);
  const message = "bookwriter: sync 5a6e6f0c-3f6c-4b9e-8c1a-1d2e3f4a5b6c";
  const unicode = "capitolo due/002-scena è con spazi 日本語.md";
  const { commit } = await publish(f, head, [
    blob("book.md", "# Libro aggiornato\n"), blob(unicode, "Nuova scena: «caffè» 🚀\n"),
    blob("vuoto.md", ""), drop(".bookwriter/project.json"),
  ], message);
  const patched = await f.api("PATCH", "/git/refs/heads/main", { sha: commit, force: false });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));
  assert.equal(patched.json.object.sha, commit);

  assert.equal(plain(f.bare, ["rev-parse", "refs/heads/main"]), commit);
  assert.deepEqual(plain(f.bare, ["log", "--format=%H", "main"]).split("\n"), [commit, head]);
  assert.equal(plain(f.bare, ["log", "-1", "--format=%an <%ae>", "main"]), "BookWriter Server <bookwriter-server@users.noreply.github.com>");
  const names = plain(f.bare, ["ls-tree", "-r", "--name-only", "-z", "main"]).split("\0").filter(Boolean).sort();
  assert.ok(names.includes(unicode) && names.includes("vuoto.md"));
  assert.ok(!names.includes(".bookwriter/project.json"));
  assert.ok(names.includes("chapters/001-uno/chapter.md"));
  assert.equal(plain(f.bare, ["show", "main:book.md"]), "# Libro aggiornato");

  const folder = f.workspace();
  assert.equal(await fs.readFile(join(folder, "book.md"), "utf8"), "# Libro aggiornato\n");
  assert.equal(await fs.readFile(join(folder, unicode), "utf8"), "Nuova scena: «caffè» 🚀\n");
  assert.equal(await fs.readFile(join(folder, "vuoto.md"), "utf8"), "");
  await assert.rejects(fs.stat(join(folder, ".bookwriter", "project.json")));
  assert.equal(await fs.readFile(join(folder, "chapters/001-uno/chapter.md"), "utf8"), "Capitolo\n");
  assert.equal(inspect(folder, ["status", "--porcelain"]), "");
  assert.equal(inspect(folder, ["rev-parse", "HEAD"]), commit);
  assert.equal(inspect(folder, ["rev-parse", "refs/remotes/origin/main"]), commit);
  assert.equal((await f.api("GET", "/git/commits/" + commit)).json.message, message);
  assert.equal(await refSha(f), commit);
}));

test("a PATCH after the remote moved is rejected with 422 and changes nothing", { skip }, async () => temporary(async root => {
  const f = await fixture(root);
  const head = await refSha(f);
  const { commit } = await publish(f, head, [blob("book.md", "# nostro\n")]);
  const theirs = await f.commit({ "book.md": "# loro\n" }, "concorrente");
  const result = await f.api("PATCH", "/git/refs/heads/main", { sha: commit, force: false });
  assert.equal(result.status, 422);
  assert.equal(plain(f.bare, ["rev-parse", "refs/heads/main"]), theirs);
  // The next read sees the remote tip: the conflict is resolved by the engine, never by forcing.
  assert.equal(await refSha(f), theirs);
  assert.equal((await f.api("PATCH", "/git/refs/heads/main", { sha: commit, force: false })).status, 422);
  assert.equal(plain(f.bare, ["rev-parse", "refs/heads/main"]), theirs);
}));

test("force and malformed PATCH bodies are refused before git is asked to push", { skip }, async () => temporary(async root => {
  const f = await fixture(root);
  const head = await refSha(f);
  const { commit } = await publish(f, head, [blob("book.md", "# nostro\n")]);
  for (const body of [{ sha: commit, force: true }, { sha: commit }, { sha: commit, force: "false" }, { sha: commit, force: 0 },
    { sha: commit, force: false, extra: 1 }, { sha: "abc", force: false }, { sha: "3".repeat(40), force: false }, { sha: head.toUpperCase().slice(1) + "0", force: false }, null, [], "x"])
    assert.equal((await f.api("PATCH", "/git/refs/heads/main", body)).status, 422, JSON.stringify(body));
  assert.equal((await f.api("PATCH", "/git/refs/heads/inesistente", { sha: commit, force: false })).status, 422);
  assert.equal((await f.api("PATCH", "/git/refs/heads/a..b", { sha: commit, force: false })).status, 422);
  assert.equal(plain(f.bare, ["rev-parse", "refs/heads/main"]), head);
  assert.equal(plain(f.bare, ["branch", "--list", "inesistente"]), "");
}));

test("branch creation is create-only, and only refs/heads is accepted", { skip }, async () => temporary(async root => {
  const f = await fixture(root);
  const head = await refSha(f);
  const created = await f.api("POST", "/git/refs", { ref: "refs/heads/bookwriter-lock/abc", sha: head });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.deepEqual(created.json.object, { type: "commit", sha: head });
  assert.equal(plain(f.bare, ["rev-parse", "refs/heads/bookwriter-lock/abc"]), head);
  const { commit } = await publish(f, head, [blob("book.md", "# altro\n")]);
  assert.equal((await f.api("POST", "/git/refs", { ref: "refs/heads/bookwriter-lock/abc", sha: commit })).status, 422);
  assert.equal(plain(f.bare, ["rev-parse", "refs/heads/bookwriter-lock/abc"]), head);
  assert.equal((await f.api("POST", "/git/refs", { ref: "refs/heads/main", sha: commit })).status, 422);
  for (const ref of ["refs/tags/v1", "heads/x", "refs/heads/", "refs/heads/../x", "refs/heads/a//b", "main", "refs/heads/x y"])
    assert.equal((await f.api("POST", "/git/refs", { ref, sha: head })).status, 422, ref);
  assert.equal((await f.api("POST", "/git/refs", { ref: "refs/heads/nuovo", sha: "4".repeat(40) })).status, 422);
  assert.equal((await f.api("POST", "/git/refs", { ref: "refs/heads/nuovo", sha: head, force: true })).status, 422);
  assert.equal(plain(f.bare, ["branch", "--list", "nuovo"]), "");
}));

test("branches list includes every branch, sorted, paginated", { skip }, async () => temporary(async root => {
  const f = await fixture(root);
  const head = await refSha(f);
  await f.api("POST", "/git/refs", { ref: "refs/heads/bookwriter-lock/zzz", sha: head });
  const side = await f.commit({ "x.md": "x\n" }, "x", "alfa");
  const all = (await f.api("GET", "/branches?per_page=100")).json;
  assert.deepEqual(all.map(branch => branch.name), ["alfa", "bookwriter-lock/zzz", "main"]);
  assert.deepEqual(all[0], { name: "alfa", commit: { sha: side } });
  assert.deepEqual((await f.api("GET", "/branches?per_page=1&page=2")).json.map(branch => branch.name), ["bookwriter-lock/zzz"]);
  assert.deepEqual((await f.api("GET", "/branches?per_page=2&page=2")).json.map(branch => branch.name), ["main"]);
}));

test("compare: identical, ahead, behind, diverged and the merge base", { skip }, async () => temporary(async root => {
  const f = await fixture(root);
  const base = f.first;
  const main = await f.commit({ "m.md": "m\n" }, "main 2");
  plain(f.other, ["checkout", "-q", "-B", "side", base]);
  const side = await f.commit({ "s.md": "s\n" }, "side 2", "side");
  const compare = async spec => (await f.api("GET", "/compare/" + spec)).json;
  assert.deepEqual(await compare(`${main}...${main}`), { status: "identical", ahead_by: 0, behind_by: 0, merge_base_commit: { sha: main } });
  assert.deepEqual(await compare(`${base}...${main}`), { status: "ahead", ahead_by: 1, behind_by: 0, merge_base_commit: { sha: base } });
  assert.deepEqual(await compare(`${main}...${base}`), { status: "behind", ahead_by: 0, behind_by: 1, merge_base_commit: { sha: base } });
  assert.deepEqual(await compare(`main...side`), { status: "diverged", ahead_by: 1, behind_by: 1, merge_base_commit: { sha: base } });
  assert.deepEqual(await compare(`${side}...main`), { status: "diverged", ahead_by: 1, behind_by: 1, merge_base_commit: { sha: base } });
  assert.equal((await f.api("GET", `/compare/${main}...${"5".repeat(40)}`)).status, 404);
  assert.equal((await f.api("GET", `/compare/main...nessun-ramo`)).status, 404);
  assert.equal((await f.api("GET", `/compare/main`)).status, 422);
}));

test("a merge commit with two parents is created and read back", { skip }, async () => temporary(async root => {
  const f = await fixture(root);
  plain(f.other, ["checkout", "-q", "-B", "side", f.first]);
  const side = await f.commit({ "s.md": "s\n" }, "side", "side");
  const main = await f.commit({ "m.md": "m\n" }, "main");
  await refSha(f, "main"); await refSha(f, "side");
  const { tree, commit } = await publish(f, main, [blob("s.md", "s\n")], "Merge branch 'side'\n\nunione", [side]);
  const read = (await f.api("GET", "/git/commits/" + commit)).json;
  assert.deepEqual(read.parents, [{ sha: main }, { sha: side }]);
  assert.equal(read.tree.sha, tree);
  assert.equal(read.message, "Merge branch 'side'\n\nunione");
  assert.equal((await f.api("PATCH", "/git/refs/heads/main", { sha: commit, force: false })).status, 200);
  assert.deepEqual(plain(f.bare, ["rev-list", "--parents", "-n", "1", "main"]).split(" "), [commit, main, side]);
  assert.equal(inspect(f.workspace(), ["status", "--porcelain"]), "");
  // Unknown or repeated parents are rejected.
  const body = { message: "x", tree, parents: [main, "6".repeat(40)] };
  assert.equal((await f.api("POST", "/git/commits", body)).status, 422);
  assert.equal((await f.api("POST", "/git/commits", { ...body, parents: [main, main] })).status, 422);
  assert.equal((await f.api("POST", "/git/commits", { ...body, parents: [tree] })).status, 422);
  assert.equal((await f.api("POST", "/git/commits", { ...body, tree: main, parents: [] })).status, 422);
  assert.equal((await f.api("POST", "/git/commits", { ...body, parents: [], author: { name: "x" } })).status, 422);
}));

test("tree entries with unsafe paths or shapes are refused", { skip }, async () => temporary(async root => {
  const f = await fixture(root);
  const head = await refSha(f);
  const base = (await f.api("GET", "/git/commits/" + head)).json.tree.sha;
  const post = tree => f.api("POST", "/git/trees", { base_tree: base, tree });
  for (const path of ["../x.md", "a/../x.md", ".git/config", ".GIT/x", ".git", "a/.git/x", "/abs.md", "\\x.md", "a\\b.md", "a//b.md", "a/", "x\u0000.md", "x\n.md", "x".repeat(401), "", ".git ", "GIT~1/x"])
    assert.equal((await post([blob(path, "x")])).status, 422, JSON.stringify(path));
  assert.equal((await post([blob("a.md", "1"), blob("a.md", "2")])).status, 422);
  assert.equal((await post([blob("a", "1"), blob("a/b", "2")])).status, 422);
  assert.equal((await post([{ ...blob("a.md", "x"), mode: "100755" }])).status, 422);
  assert.equal((await post([{ ...blob("a.md", "x"), mode: "120000" }])).status, 422);
  assert.equal((await post([{ ...blob("a.md", "x"), type: "tree" }])).status, 422);
  assert.equal((await post([{ path: "a.md", mode: "100644", type: "blob" }])).status, 422);
  assert.equal((await post([{ path: "a.md", mode: "100644", type: "blob", sha: head }])).status, 422);
  assert.equal((await post([{ path: "a.md", mode: "100644", type: "blob", content: "x", sha: null }])).status, 422);
  assert.equal((await post([{ ...blob("a.md", "x"), extra: true }])).status, 422);
  assert.equal((await post([blob("a.md", "x\ud800")])).status, 422);
  assert.equal((await f.api("POST", "/git/trees", { base_tree: "7".repeat(40), tree: [blob("a.md", "x")] })).status, 422);
  assert.equal((await f.api("POST", "/git/trees", { base_tree: "zz", tree: [] })).status, 422);
  assert.equal((await f.api("POST", "/git/trees", { tree: "no" })).status, 422);
  assert.equal((await f.api("POST", "/git/trees", { base_tree: base, tree: [], extra: 1 })).status, 422);
  assert.equal((await post([blob("grande.md", "x".repeat(13 * 1024 * 1024))])).status, 413);
  // Nothing from the refused requests reached the working copy's object store or leftovers.
  assert.deepEqual((await fs.readdir(join(f.workspace(), ".git"))).filter(name => name.startsWith("bw-")), []);
  assert.equal(plain(f.bare, ["rev-parse", "refs/heads/main"]), head);
}));

test("paths with spaces and unicode, an empty tree and a deletion of a missing file", { skip }, async () => temporary(async root => {
  const f = await fixture(root);
  const head = await refSha(f);
  const { commit } = await publish(f, head, [blob("a b/è ü 日本語 .md", "ok\n"), drop("non-esiste.md")]);
  assert.equal((await f.api("PATCH", "/git/refs/heads/main", { sha: commit, force: false })).status, 200);
  const read = (await f.api("GET", "/contents/a%20b/%C3%A8%20%C3%BC%20%E6%97%A5%E6%9C%AC%E8%AA%9E%20.md?ref=" + commit)).json;
  assert.equal(Buffer.from(read.content, "base64").toString("utf8"), "ok\n");
  const empty = await f.api("POST", "/git/trees", { tree: [] });
  assert.equal(empty.status, 201);
  assert.equal(empty.json.sha, "4b825dc642cb6eb9a060e54bf8d69288fbee4904");
  const onlyDeletion = await f.api("POST", "/git/trees", { base_tree: head, tree: [drop("book.md"), drop(".bookwriter/project.json"), drop("chapters/001-uno/chapter.md"), drop("chapters/001-uno/001-scena con spazi è.md")] });
  assert.equal(onlyDeletion.json.sha, empty.json.sha);
}));

test("the commit message round-trips exactly", { skip }, async () => temporary(async root => {
  const f = await fixture(root);
  const head = await refSha(f);
  const tree = (await f.api("GET", "/git/commits/" + head)).json.tree.sha;
  for (const message of ["bookwriter: sync abc", "senza a capo finale", "con a capo finale\n", "riga\n\n\nvuote\n\n", "  spazi  \n\ttab\n",
    "a\r\nb\r\n", "Èè 日本語 🚀 «x»\n\nCorpo", "", "-- non un'opzione", "# non un commento\nriga"]) {
    const made = await f.api("POST", "/git/commits", { message, tree, parents: [head] });
    assert.equal(made.status, 201, JSON.stringify(message));
    assert.equal((await f.api("GET", "/git/commits/" + made.json.sha)).json.message, message, JSON.stringify(message));
  }
  assert.equal((await f.api("POST", "/git/commits", { message: "a\0b", tree, parents: [] })).status, 422);
  assert.equal((await f.api("POST", "/git/commits", { message: "a\ud800", tree, parents: [] })).status, 422);
  assert.equal((await f.api("POST", "/git/commits", { message: 5, tree, parents: [] })).status, 422);
}));

test("what the transport does not handle is left to HTTPS", { skip }, async () => temporary(async root => {
  const f = await fixture(root);
  const handle = (method, path, body) => f.workspaces.transport.handle({ token: SENTINEL, method, path, body });
  for (const [method, path] of [
    ["GET", REPO], ["PUT", REPO + "/contents/.bookwriter/initialization.json"], ["GET", REPO + "/git/ref/tags/v1"],
    ["GET", REPO + "/commits"], ["GET", REPO + "/commits?sha=x&path=a"], ["POST", REPO + "/git/tags"], ["DELETE", REPO + "/git/refs/tags/v1"], ["DELETE", REPO + "/git/refs"],
    ["GET", REPO + "/contents/book.md"], ["GET", "/user"], ["GET", "/repos/acme"], ["GET", REPO + "/git/trees"], ["GET", REPO + "/git/blobs"],
    ["POST", REPO + "/git/refs/heads/main"], ["PATCH", REPO + "/git/refs"], ["PATCH", REPO + "/git/refs/tags/v1"],
  ]) assert.equal(await handle(method, path), undefined, method + " " + path);
  assert.equal((await handle("GET", "/repos/-cattivo/book/git/ref/heads/main")).status, 422);
  assert.equal((await handle("GET", "/repos/acme/ba%2Fd/git/ref/heads/main")).status, 422);
  assert.equal((await handle("GET", "/repos/acme/x.git/git/ref/heads/main")).status, 422);
  assert.equal((await handle("GET", REPO + "/contents/a%2Fb?ref=main")).status, 422);
  assert.equal(await handle("GET", REPO + "/git/ref/heads/%E0%A4%A"), undefined);
}));

test("the PAT never reaches the working copy, the home or an error message", { skip }, async () => temporary(async root => {
  const f = await fixture(root);
  const head = await refSha(f);
  const { commit } = await publish(f, head, [blob("book.md", "# x\n")]);
  assert.equal((await f.api("PATCH", "/git/refs/heads/main", { sha: commit, force: false })).status, 200);
  assert.equal((await f.api("POST", "/git/refs", { ref: "refs/heads/altro", sha: commit })).status, 201);
  const needles = [SENTINEL, Buffer.from("x-access-token:" + SENTINEL).toString("base64"), "Authorization"].map(text => Buffer.from(text));
  for (const dir of [join(root, "server")])
    for (const file of await walk(dir)) {
      const bytes = await fs.readFile(file);
      for (const needle of needles) assert.ok(!bytes.includes(needle), file + " contiene " + needle);
    }
  const config = await fs.readFile(join(f.workspace(), ".git", "config"), "utf8");
  assert.match(config, /url = file:/);
  assert.ok(!/extraheader|Authorization|token/i.test(config));
  // A failure carries a fixed message: no token, no git text, no local path.
  const lost = await fixture(await fs.mkdtemp(join(root, "lost-")), { urlFor: () => pathToFileURL(join(root, "nessuna-repo.git")).href });
  const error = await lost.api("GET", "/git/ref/heads/main").catch(failure => failure);
  assert.ok(error instanceof Error);
  assert.equal(error.message, NETWORK);
  assert.ok(!JSON.stringify(error, Object.getOwnPropertyNames(error)).includes(SENTINEL));
}));

test("a stale index.lock does not block a push or the folder refresh", { skip }, async () => temporary(async root => {
  const f = await fixture(root);
  const head = await refSha(f);
  const { commit } = await publish(f, head, [blob("book.md", "# nuovo\n")]);
  await fs.writeFile(join(f.workspace(), ".git", "index.lock"), "");
  await fs.writeFile(join(f.workspace(), ".git", "shallow.lock"), "");
  assert.equal((await f.api("PATCH", "/git/refs/heads/main", { sha: commit, force: false })).status, 200);
  assert.equal(await fs.readFile(join(f.workspace(), "book.md"), "utf8"), "# nuovo\n");
  await assert.rejects(fs.stat(join(f.workspace(), ".git", "index.lock")));
  assert.equal(inspect(f.workspace(), ["status", "--porcelain"]), "");
  // Untracked leftovers in the folder are removed too: the folder always mirrors the remote.
  await fs.writeFile(join(f.workspace(), "residuo.md"), "x");
  const next = await publish(f, commit, [blob("book.md", "# ancora\n")]);
  assert.equal((await f.api("PATCH", "/git/refs/heads/main", { sha: next.commit, force: false })).status, 200);
  await assert.rejects(fs.stat(join(f.workspace(), "residuo.md")));
}));

test("two concurrent pushes to one repository serialize without corruption", { skip }, async () => temporary(async root => {
  const f = await fixture(root);
  const head = await refSha(f);
  const one = await publish(f, head, [blob("a.md", "uno\n")], "uno");
  const two = await publish(f, head, [blob("b.md", "due\n")], "due");
  const reads = Array.from({ length: 6 }, () => f.api("GET", "/git/trees/" + head + "?recursive=1"));
  const results = await Promise.all([
    f.api("PATCH", "/git/refs/heads/main", { sha: one.commit, force: false }),
    f.api("PATCH", "/git/refs/heads/main", { sha: two.commit, force: false }),
    ...reads,
  ]);
  assert.deepEqual(results.slice(0, 2).map(result => result.status), [200, 422]);
  assert.ok(results.slice(2).every(result => result.status === 200 && result.json.tree.length > 0));
  assert.equal(plain(f.bare, ["rev-parse", "refs/heads/main"]), one.commit);
  plain(f.bare, ["fsck", "--no-dangling"]);
  inspect(f.workspace(), ["fsck", "--no-dangling"]);
  assert.equal(inspect(f.workspace(), ["status", "--porcelain"]), "");
  // Different repositories do not wait for each other and have their own folders.
  const other = await f.workspaces.transport.handle({ token: SENTINEL, method: "GET", path: "/repos/acme/altro/git/ref/heads/main" });
  assert.equal(other.status, 200);
  assert.notEqual(f.workspaces.workspacePath("acme", "altro"), f.workspace());
}));

test("workspaces are lower-cased, created lazily and fail closed on a foreign origin", { skip }, async () => temporary(async root => {
  const f = await fixture(root);
  assert.equal(f.workspace(), join(root, "server", "git", "acme__book"));
  await assert.rejects(fs.stat(f.workspace()));
  const upper = await f.workspaces.transport.handle({ token: SENTINEL, method: "GET", path: "/repos/ACME/Book/git/ref/heads/main" });
  assert.equal(upper.status, 200);
  assert.equal((await fs.readdir(join(root, "server", "git"))).join(), "acme__book");
  assert.equal(f.workspaces.workspacePath("ACME", "Book"), f.workspace());
  assert.throws(() => f.workspaces.workspacePath("a/b", "c"));
  assert.throws(() => f.workspaces.workspacePath("acme", ".."));
  assert.equal((await fs.stat(join(root, "server", "git-home"))).isDirectory(), true);

  const foreign = new GitWorkspaces({ root: join(root, "server"), urlFor: () => pathToFileURL(join(root, "altra.git")).href, allowFileProtocol: true });
  await assert.rejects(foreign.transport.handle({ token: SENTINEL, method: "GET", path: REPO + "/git/ref/heads/main" }), /altra origine/);
  await foreign.close();

  await fs.mkdir(join(root, "server", "git", "acme__occupata"), { recursive: true });
  await fs.writeFile(join(root, "server", "git", "acme__occupata", "file.txt"), "non mio");
  await assert.rejects(f.workspaces.transport.handle({ token: SENTINEL, method: "GET", path: "/repos/acme/occupata/git/ref/heads/main" }), /non è un repository/);
  assert.equal(await fs.readFile(join(root, "server", "git", "acme__occupata", "file.txt"), "utf8"), "non mio");
  await f.workspaces.close();
  await assert.rejects(f.workspaces.transport.handle({ token: SENTINEL, method: "GET", path: REPO + "/git/ref/heads/main" }), /chiuso/);
}));

test("a remote that is not file:// is refused unless explicitly allowed, and URLs carry no credentials", { skip }, async () => temporary(async root => {
  const bare = pathToFileURL(join(root, "x.git")).href;
  const noFile = new GitWorkspaces({ root: join(root, "a"), urlFor: () => bare });
  await assert.rejects(noFile.transport.handle({ token: SENTINEL, method: "GET", path: REPO + "/git/ref/heads/main" }), /non consentito/);
  for (const url of ["https://utente:segreto@github.com/acme/book.git", "http://github.com/acme/book.git", "ssh://git@github.com/acme/book.git", "non un url"]) {
    const bad = new GitWorkspaces({ root: join(root, "b"), urlFor: () => url, allowFileProtocol: true });
    await assert.rejects(bad.transport.handle({ token: SENTINEL, method: "GET", path: REPO + "/git/ref/heads/main" }), error => !error.message.includes("segreto"));
  }
}));

test("large blobs are refused with 413", { skip }, async () => temporary(async root => {
  const f = await fixture(root);
  const big = await f.commit({ "grande.bin": "x".repeat(12 * 1024 * 1024 + 1) }, "grande");
  const entry = (await f.api("GET", "/git/trees/" + big + "?recursive=1")).json.tree.find(item => item.path === "grande.bin");
  assert.equal((await f.api("GET", "/git/blobs/" + entry.sha)).status, 413);
  assert.equal((await f.api("GET", "/contents/grande.bin?ref=" + big)).status, 413);
  assert.equal((await f.api("GET", "/contents/book.md?ref=" + big)).status, 200);
}));

test("without a reachable remote: local operations work, push and reads fail with the ambiguous message", { skip }, async () => temporary(async root => {
  const missing = pathToFileURL(join(root, "non-esiste.git")).href;
  const workspaces = new GitWorkspaces({ root: join(root, "server"), urlFor: () => missing, allowFileProtocol: true });
  const api = (method, suffix, body) => workspaces.transport.handle({ token: SENTINEL, method, path: REPO + suffix, body });
  const tree = await api("POST", "/git/trees", { tree: [blob("book.md", "# locale\n")] });
  assert.equal(tree.status, 201);
  const commit = await api("POST", "/git/commits", { message: "locale", tree: tree.json.sha, parents: [] });
  assert.equal(commit.status, 201);
  for (const [method, suffix, body] of [
    ["PATCH", "/git/refs/heads/main", { sha: commit.json.sha, force: false }],
    ["POST", "/git/refs", { ref: "refs/heads/nuovo", sha: commit.json.sha }],
    ["GET", "/git/ref/heads/main"], ["GET", "/branches"], ["GET", "/contents/book.md?ref=" + "8".repeat(40)], ["GET", "/compare/main...side"],
  ]) await assert.rejects(api(method, suffix, body), error => error.message === NETWORK, method + " " + suffix);
  // What is already local stays readable offline.
  assert.equal((await api("GET", "/git/commits/" + commit.json.sha)).json.message, "locale");
  assert.equal(Buffer.from((await api("GET", "/contents/book.md?ref=" + commit.json.sha)).json.content, "base64").toString("utf8"), "# locale\n");
  assert.equal((await api("GET", "/commits?sha=" + commit.json.sha)).json[0].sha, commit.json.sha);
  await workspaces.close();
}));

/** A git that records what it was given, fails or hangs on network commands, and is real otherwise. */
async function spy(root) {
  const log = join(root, "spy-log");
  await fs.mkdir(log, { recursive: true });
  const script = join(root, "spy-git");
  await fs.writeFile(script, `#!/bin/sh
LOG='${log}'
cmd="$1"
case "$cmd" in
  init|config)
    env > "$LOG/$cmd.env";;
  fetch|ls-remote|push)
    env > "$LOG/$cmd.env"
    printf '%s\\n' "$@" > "$LOG/$cmd.args"
    mode=$(cat "$LOG/$cmd.mode" 2>/dev/null)
    if [ "$mode" = "hang" ]; then echo $$ > "$LOG/$cmd.pid"; exec sleep 30; fi
    if [ "$mode" = "heads" ]; then printf '%s\\trefs/heads/main\\n' 9999999999999999999999999999999999999999; exit 0; fi
    echo "fatal: unable to access 'https://github.com/acme/book.git/': Could not resolve host: github.com" >&2
    exit 128;;
esac
exec git "$@"
`, { mode: 0o755 });
  const mode = (command, value) => fs.writeFile(join(log, command + ".mode"), value);
  return { log, script, mode };
}

test("the PAT travels only as an HTTP header in the environment of github.com requests", { skip: skip || !posix && "serve uno script eseguibile" }, async () => temporary(async root => {
  const { log, script } = await spy(root);
  const workspaces = new GitWorkspaces({ root: join(root, "server"), binary: script });
  const result = await workspaces.transport.handle({ token: SENTINEL, method: "GET", path: REPO + "/git/ref/heads/main" }).catch(error => error);
  assert.equal(result.message, NETWORK);
  const env = await fs.readFile(join(log, "fetch.env"), "utf8");
  const header = "Authorization: Basic " + Buffer.from("x-access-token:" + SENTINEL).toString("base64");
  const lines = env.split("\n");
  const keyLine = lines.find(line => line.endsWith("=http.https://github.com/.extraheader"));
  assert.ok(keyLine, "la chiave dell'header manca");
  assert.ok(lines.includes(keyLine.replace("KEY", "VALUE").split("=")[0] + "=" + header));
  assert.ok(lines.includes("GIT_ALLOW_PROTOCOL=https"));
  assert.ok(lines.includes("GIT_TERMINAL_PROMPT=0"));
  assert.ok(lines.includes("GIT_CONFIG_NOSYSTEM=1"));
  assert.ok(lines.includes("HOME=" + join(root, "server", "git-home")));
  assert.ok(!lines.some(line => line.startsWith("BOOKWRITER")));
  const args = await fs.readFile(join(log, "fetch.args"), "utf8");
  assert.ok(!args.includes(SENTINEL) && !args.includes(Buffer.from("x-access-token:" + SENTINEL).toString("base64")));
  assert.deepEqual(args.trim().split("\n").slice(0, 5), ["fetch", "--no-tags", "--quiet", "origin", "refs/heads/main"]);
  const config = await fs.readFile(join(workspaces.workspacePath("acme", "book"), ".git", "config"), "utf8");
  assert.ok(!config.includes(SENTINEL) && !/extraheader/i.test(config));
  assert.match(config, /url = https:\/\/github\.com\/acme\/book\.git\n/);
  // A malformed PAT is refused before any process starts.
  await assert.rejects(workspaces.transport.handle({ token: "", method: "GET", path: REPO + "/git/ref/heads/main" }).then(value => { throw Object.assign(new Error("status " + value.status), { value }); }),
    error => error.value?.status === 401);
  await workspaces.close();
}));

test("network git commands inherit the server's proxy and CA settings and nothing else; the PAT stays out of config and errors", { skip: skip || !posix && "serve uno script eseguibile" }, async () => temporary(async root => {
  await withEnvironment({ ...FORWARDED, ...NOT_FORWARDED }, async () => {
    const { log, script } = await spy(root);
    const workspaces = new GitWorkspaces({ root: join(root, "server"), binary: script });
    const result = await workspaces.transport.handle({ token: SENTINEL, method: "GET", path: REPO + "/git/ref/heads/main" }).catch(error => error);
    assert.equal(result.message, NETWORK);
    const lines = (await fs.readFile(join(log, "fetch.env"), "utf8")).split("\n");
    for (const [name, value] of Object.entries(FORWARDED)) assert.ok(lines.includes(name + "=" + value), name);
    for (const name of ["SECRET_SENTINEL", "GITHUB_TOKEN", "GH_TOKEN", "GIT_SSL_NO_VERIFY", "GIT_TRACE"])
      assert.ok(!lines.some(line => line.startsWith(name + "=")), name);
    assert.ok(lines.includes("GIT_ASKPASS="));
    assert.ok(!lines.some(line => /must-not-leak|must_not_leak|evil-askpass/.test(line)));
    assert.ok(!lines.some(line => line.includes(SENTINEL)));
    assert.ok(lines.some(line => line.startsWith("GIT_CONFIG_VALUE_") && line.includes("Authorization: Basic ")));
    // Local commands never need a proxy: they do not get one.
    for (const command of ["init", "config"]) {
      const local = await fs.readFile(join(log, command + ".env"), "utf8");
      for (const name of Object.keys(FORWARDED)) assert.ok(!local.split("\n").some(line => line.startsWith(name + "=")), command + " " + name);
    }
    const config = await fs.readFile(join(workspaces.workspacePath("acme", "book"), ".git", "config"), "utf8");
    for (const secret of [SENTINEL, "proxysecret", "proxy.invalid"]) assert.ok(!config.includes(secret), secret);
    assert.ok(!result.message.includes("proxysecret") && !result.message.includes(SENTINEL));
    const args = await fs.readFile(join(log, "fetch.args"), "utf8");
    assert.ok(!args.includes("proxysecret") && !args.includes(SENTINEL));
    await workspaces.close();

    const isolated = new GitWorkspaces({ root: join(root, "isolated"), binary: script, forwardNetworkEnvironment: false });
    const refused = await isolated.transport.handle({ token: SENTINEL, method: "GET", path: REPO + "/git/ref/heads/main" }).catch(error => error);
    assert.equal(refused.message, NETWORK);
    const bare = (await fs.readFile(join(log, "fetch.env"), "utf8")).split("\n");
    for (const name of Object.keys(FORWARDED)) assert.ok(!bare.some(line => line.startsWith(name + "=")), name);
    assert.ok(bare.some(line => line.startsWith("GIT_CONFIG_VALUE_") && line.includes("Authorization: Basic ")));
    await isolated.close();
  });
}));

test("a push that hangs is killed on timeout and reported as ambiguous; an abort kills the process", { skip: skip || !posix && "serve uno script eseguibile" }, async () => temporary(async root => {
  const { log, script, mode } = await spy(root);
  const workspaces = new GitWorkspaces({ root: join(root, "server"), binary: script, timeoutMs: 1500 });
  const api = (method, suffix, body, signal) => workspaces.transport.handle({ token: SENTINEL, method, path: REPO + suffix, body, signal });
  const tree = await api("POST", "/git/trees", { tree: [blob("book.md", "x\n")] });
  const commit = await api("POST", "/git/commits", { message: "x", tree: tree.json.sha, parents: [] });
  await mode("ls-remote", "heads");
  await mode("push", "hang");
  const started = Date.now();
  await assert.rejects(api("PATCH", "/git/refs/heads/main", { sha: commit.json.sha, force: false }), error => error.message === NETWORK);
  assert.ok(Date.now() - started < 10_000);
  const pid = Number((await fs.readFile(join(log, "push.pid"), "utf8")).trim());
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.throws(() => process.kill(pid, 0), error => error.code === "ESRCH");
  const args = (await fs.readFile(join(log, "push.args"), "utf8")).trim().split("\n");
  assert.deepEqual(args, ["push", "--porcelain", "--no-verify", "--no-recurse-submodules", "origin", commit.json.sha + ":refs/heads/main"]);
  assert.ok(!args.some(arg => /force|^\+|lease/.test(arg)));

  await mode("ls-remote", "hang");
  const controller = new AbortController();
  const pending = api("GET", "/branches", undefined, controller.signal).catch(error => error);
  await new Promise(resolve => setTimeout(resolve, 400));
  controller.abort();
  const aborted = await pending;
  assert.equal(aborted.name, "AbortError");
  const hung = Number((await fs.readFile(join(log, "ls-remote.pid"), "utf8")).trim());
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.throws(() => process.kill(hung, 0), error => error.code === "ESRCH");
  const already = new AbortController(); already.abort();
  await assert.rejects(api("GET", "/branches", undefined, already.signal), error => error.name === "AbortError");
  await workspaces.close();
}));

test("deleting a branch: only heads, never a lease branch, missing is refused, the working copy forgets it", { skip }, async () => temporary(async root => {
  const f = await fixture(root);
  const head = await refSha(f);
  assert.equal((await f.api("POST", "/git/refs", { ref: "refs/heads/bozza", sha: head })).status, 201);
  assert.equal((await f.api("POST", "/git/refs", { ref: "refs/heads/bookwriter-lock/abc", sha: head })).status, 201);
  assert.equal((await f.api("DELETE", "/git/refs/heads/bookwriter-lock/abc")).status, 422, "lease branches are not deletable here");
  assert.ok(plain(f.bare, ["rev-parse", "--verify", "refs/heads/bookwriter-lock/abc"]));
  assert.equal((await f.api("DELETE", "/git/refs/heads/nope")).status, 422);
  assert.equal((await f.api("DELETE", "/git/refs/heads/bozza")).status, 204);
  assert.throws(() => plain(f.bare, ["rev-parse", "--verify", "refs/heads/bozza"]));
  assert.equal(await refSha(f, "bozza"), undefined);
  assert.equal((await f.api("GET", "/git/ref/heads/bozza")).status, 404);
  assert.equal(await refSha(f), head, "main is untouched");
  assert.equal((await f.api("DELETE", "/git/refs/heads/bozza")).status, 422, "already gone");
}));
