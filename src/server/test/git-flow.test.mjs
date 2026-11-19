import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  startPersonalServer, bookEtag, DEFAULT_SETTINGS, MemoryGitHub, projectBook, GitWorkspaces,
} from "../dist/testing.mjs";

const run = promisify(execFile);
const probe = await GitWorkspaces.probe().then(() => undefined, error => error.message);
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: "", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
const git = (cwd, ...args) => run("git", ["-c", "user.name=Esterno", "-c", "user.email=esterno@example.test", "-c", "commit.gpgsign=false", "-c", "protocol.file.allow=always", ...args], { cwd, env: gitEnv });
const TEXT = ["Apertura.", "Il faro era spento.", "Mara salì le scale.", "Parlò con Elio.", "Chiusura."].join("\n");

async function fixture(action, { ai } = {}) {
  const base = process.platform === "win32" ? tmpdir() : process.env.BOOKWRITER_TEST_TMP ?? "/tmp/opencode";
  await fs.mkdir(base, { recursive: true, mode: 0o700 });
  const dir = await fs.mkdtemp(join(base, "bookwriter-gitflow-"));
  const origin = join(dir, "origin.git"), root = join(dir, "data"), seed = join(dir, "seed"), ext = join(dir, "ext");
  await fs.mkdir(root, { mode: 0o700 });
  await git(dir, "init", "--bare", "-b", "main", origin);
  await git(dir, "clone", pathToFileURL(origin).href, seed);
  await fs.writeFile(join(seed, "LEGGIMI.txt"), "Repository di prova\n");
  await git(seed, "add", "-A"); await git(seed, "commit", "-m", "inizio"); await git(seed, "push", "origin", "HEAD:refs/heads/main");
  const service = await startPersonalServer({ root, apiPort: 0, adminPort: 0,
    git: { urlFor: () => pathToFileURL(origin).href, allowFileProtocol: true } });
  assert.equal(service.git.mode, "git");
  const memory = new MemoryGitHub();
  await memory.commit("main", { "LEGGIMI.txt": "stato usato solo per il blocco di scrittura\n" });
  await memory.commit("bozza", { "LEGGIMI.txt": "stato usato solo per il blocco di scrittura\n" });
  const native = globalThis.fetch;
  const calls = { ai: 0 };
  globalThis.fetch = async (raw, init = {}) => {
    const url = new URL(String(raw));
    if (url.origin === "https://api.openai.com") {
      calls.ai++;
      assert.ok(ai, "unexpected AI call");
      return Response.json({ choices: [{ message: { content: await ai(JSON.parse(init.body)) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    }
    assert.equal(url.origin, "https://api.github.com");
    const result = await memory.handle({ token: "x", method: init.method ?? "GET", path: url.pathname + url.search, body: init.body ? JSON.parse(init.body) : undefined })
      ?? { status: 404, json: {} };
    return Response.json(result.json, { status: result.status, headers: { "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 1800) } });
  };
  const tokens = await service.auth.issue("Git", ["read", "write", "run"]);
  const client = service.auth.authenticate(tokens.token);
  const send = async (id, command) => {
    const record = await service.store.read(id);
    const commandId = randomUUID();
    await service.controller.command(id, client, bookEtag(record), { commandId, sequence: (record.watermarks[client.id] ?? 0) + 1, command });
    await service.controller.waitForIdle();
    return (await service.store.read(id)).commands[commandId];
  };
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.defaultRoute.modelId = "default-model";
  settings.endpoints[0].secret = await service.runtime.encrypt("chiave-sintetica");
  await service.runtime.saveSettings(settings);
  const id = await service.controller.create(client, randomUUID(), { title: "Il faro", brief: "Un faro e una donna.", writingStyle: "Sobrio", audience: "Adulti" });
  const credentials = await native(`http://127.0.0.1:${service.apiPort}/api/v1/books/${id}/github-credential`, { method: "POST",
    headers: { apikey: tokens.token, "Content-Type": "application/json", "If-Match": '"config:1"' }, body: JSON.stringify({ consent: true, githubToken: "pat-sintetico" }) });
  assert.equal(credentials.status, 200);
  await service.store.transaction(id, record => {
    record.book.phase = "completed"; record.book.status = "completed";
    record.book.chapters = [{ id: "ch:1", number: 1, title: "Il ponte", purpose: "p", frozenAt: "2026-01-01T00:00:00.000Z", summary: "riassunto",
      scenes: [{ id: "s:1", number: 1, title: "Incontro", objective: "o", text: TEXT, status: "canon", summary: "s" }] }];
  });
  assert.equal((await send(id, { type: "connect_github", owner: "synthetic", repository: "review", branch: "main", consentPublic: false })).result.connected, true);
  const saved = await send(id, { type: "save_github", consentPublic: false });
  assert.equal(saved.state, "completed", JSON.stringify(saved.result));
  const book = async () => (await service.store.read(id)).book;
  const sceneText = async () => (await book()).chapters[0].scenes[0].text;
  /** Another device: a clone, a changed book and a push — through the same projection the app writes. */
  const external = async (branch, change) => {
    await fs.rm(ext, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    await git(dir, "clone", "--branch", branch, pathToFileURL(origin).href, ext);
    const current = JSON.parse(await fs.readFile(join(ext, ".bookwriter", "project.json"), "utf8"));
    change(current);
    current.updatedAt = new Date(Date.parse(current.updatedAt) + 60_000).toISOString();
    const projection = projectBook(current, []);
    await git(ext, "rm", "-r", "-q", "--ignore-unmatch", ".");
    for (const [path, content] of Object.entries({ ...projection.files, ".bookwriter/manifest.json": JSON.stringify(projection.manifest, null, 2) + "\n" })) {
      await fs.mkdir(join(ext, path, ".."), { recursive: true }); await fs.writeFile(join(ext, path), content);
    }
    await git(ext, "add", "-A"); await git(ext, "commit", "-m", "modifica da un altro dispositivo"); await git(ext, "push", "origin", `HEAD:refs/heads/${branch}`);
    return (await git(ext, "rev-parse", "HEAD")).stdout.trim();
  };
  const head = async branch => (await git(origin, "rev-parse", `refs/heads/${branch}`)).stdout.trim();
  const parents = async sha => (await git(origin, "rev-list", "--parents", "-n", "1", sha)).stdout.trim().split(" ").slice(1);
  try { await action({ service, id, send, book, sceneText, external, head, parents, origin, root, calls, client }); }
  finally { globalThis.fetch = native; await service.close(); await fs.rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); }
}
const skip = probe ? { skip: probe } : {};
const edit = (patch) => book => { Object.assign(book.chapters[0].scenes[0], patch); };

test("the first save is a real git push and leaves a working folder with the book", skip, () => fixture(async ({ service, book, head, root }) => {
  const committed = (await book()).remote.lastSyncedCommit;
  assert.equal(committed, await head("main"));
  const folder = join(root, "git", "synthetic__review");
  assert.ok(JSON.parse(await fs.readFile(join(folder, ".bookwriter", "project.json"), "utf8")).executionAuthority);
  assert.equal((await git(folder, "rev-parse", "HEAD")).stdout.trim(), committed);
  assert.equal((await fs.readFile(join(folder, "book.md"), "utf8")).includes("Il faro"), true);
  assert.equal(service.git.mode, "git");
}));

test("pull: fast-forward when nothing changed here, three-way merge when both sides changed", skip, () => fixture(async ({ send, book, sceneText, external, head, parents, id, service }) => {
  const first = await external("main", edit({ text: TEXT.replace("Chiusura.", "Chiusura, di notte.") }));
  const forwarded = await send(id, { type: "git_pull", mode: "author", consentAi: false });
  assert.equal(forwarded.result.state, "fast_forwarded", JSON.stringify(forwarded.result));
  assert.equal((await book()).remote.lastSyncedCommit, first);
  assert.match(await sceneText(), /di notte/);
  assert.equal((await send(id, { type: "git_pull", mode: "author", consentAi: false })).result.state, "current");

  // Edited here (not saved) and elsewhere in a different place: both survive in a merge commit.
  const edited = await sceneText();
  const text = edited.replace("Il faro era spento.", "Il faro era spento da anni.");
  const record = await service.store.read(id);
  await send(id, { type: "edit_scene", sceneId: "s:1", expectedStamp: (await import("../dist/testing.mjs")).currentStamp(record.book, { kind: "scene", id: "s:1" }), patch: { text } });
  const other = await external("main", edit({ text: edited.replace("Apertura.", "Prologo.\nApertura.") }));
  const merged = await send(id, { type: "git_pull", mode: "author", consentAi: false });
  assert.equal(merged.result.state, "merged", JSON.stringify(merged.result));
  const final = await sceneText();
  assert.ok(final.includes("Prologo.") && final.includes("spento da anni") && final.includes("di notte"));
  const tip = await head("main");
  assert.equal((await book()).remote.lastSyncedCommit, tip);
  assert.equal((await parents(tip)).length, 2);
  assert.ok((await parents(tip)).includes(other));
  assert.equal((await book()).chapters[0].frozenAt, undefined, "the touched chapter is reopened for review");
}));

test("pull with the same line changed on both sides stops for the author; nothing starts until it is decided", skip, () => fixture(async ({ send, book, sceneText, external, head, id, service }) => {
  const { currentStamp } = await import("../dist/testing.mjs");
  const record = await service.store.read(id);
  await send(id, { type: "edit_scene", sceneId: "s:1", expectedStamp: currentStamp(record.book, { kind: "scene", id: "s:1" }), patch: { text: TEXT.replace("Parlò con Elio.", "Tacque.") } });
  const theirs = await external("main", edit({ text: TEXT.replace("Parlò con Elio.", "Urlò.") }));
  const pulled = await send(id, { type: "git_pull", mode: "author", consentAi: false });
  assert.equal(pulled.result.state, "needs_resolution", JSON.stringify(pulled.result));
  const session = (await book()).mergeSession;
  assert.equal(session.conflicts.length, 1);
  assert.equal(session.theirsCommit, theirs);
  await assert.rejects(send(id, { type: "start" }), error => error.code === "merge_pending");
  const publishedBefore = await head("main");
  await assert.rejects(send(id, { type: "save_github", consentPublic: false }), error => error.code === "merge_pending");
  assert.equal(await head("main"), publishedBefore, "a half-decided merge never leaves the server");
  assert.equal((await send(id, { type: "git_merge_finish", mergeId: session.id })).state, "uncertain", "undecided conflicts cannot be published");
  const decided = await send(id, { type: "git_merge_resolve", mergeId: session.id, decisions: { [session.conflicts[0].id]: { choice: "theirs" } } });
  assert.equal(decided.result.unresolved, 0, JSON.stringify(decided.result));
  const finished = await send(id, { type: "git_merge_finish", mergeId: session.id });
  assert.equal(finished.state, "completed", JSON.stringify(finished.result));
  assert.match(await sceneText(), /Urlò/);
  assert.equal((await book()).mergeSession, undefined);
  assert.equal((await book()).remote.lastSyncedCommit, await head("main"));
}));

test("starting the autopilot first reads the repository: what was pushed elsewhere is taken, or decided, before any run", skip, () => fixture(async ({ send, book, sceneText, external, head, id, service, calls }) => {
  const { currentStamp } = await import("../dist/testing.mjs");
  const moved = await external("main", edit({ text: TEXT.replace("Chiusura.", "Chiusura, di notte.") }));
  const started = await send(id, { type: "start" });
  assert.equal(started.state, "completed", JSON.stringify(started.result));
  assert.equal((await book()).remote.lastSyncedCommit, moved);
  assert.match(await sceneText(), /di notte/);
  assert.equal(calls.ai, 0);

  const record = await service.store.read(id);
  await send(id, { type: "edit_scene", sceneId: "s:1", expectedStamp: currentStamp(record.book, { kind: "scene", id: "s:1" }), patch: { text: TEXT.replace("Parlò con Elio.", "Tacque.").replace("Chiusura.", "Chiusura, di notte.") } });
  await external("main", edit({ text: TEXT.replace("Parlò con Elio.", "Urlò.").replace("Chiusura.", "Chiusura, di notte.") }));
  const refused = await send(id, { type: "start" });
  assert.equal(refused.result.code, "merge_required", JSON.stringify(refused.result));
  assert.equal((await service.store.read(id)).runAuthorization.state, "stopped");
  assert.equal((await book()).mergeSession.conflicts.length, 1);
  assert.equal(calls.ai, 0);
  assert.notEqual(await head("main"), (await book()).remote.lastSyncedCommit);
}));

test("branches: create from the current one, work on it, go back, and merge it — conflicts decided by the author", skip, () => fixture(async ({ send, book, sceneText, external, head, parents, id, service }) => {
  const { currentStamp } = await import("../dist/testing.mjs");
  const created = await send(id, { type: "git_create_branch", name: "bozza", switchTo: true });
  assert.equal(created.result.switched, true, JSON.stringify(created.result));
  assert.equal((await book()).remote.branch, "bozza");
  assert.equal(await head("bozza"), await head("main"));
  const record = await service.store.read(id);
  await send(id, { type: "edit_scene", sceneId: "s:1", expectedStamp: currentStamp(record.book, { kind: "scene", id: "s:1" }), patch: { text: TEXT.replace("Parlò con Elio.", "Tacque.") } });
  const saved = await send(id, { type: "save_github", consentPublic: false });
  assert.equal(saved.state, "completed", JSON.stringify(saved.result));
  assert.notEqual(await head("bozza"), await head("main"));

  const dirty = await send(id, { type: "git_switch_branch", branch: "main" });
  assert.equal(dirty.state, "completed", "the book is saved, so it can switch");
  assert.equal((await book()).remote.branch, "main");
  assert.equal(await sceneText(), TEXT);

  await external("main", edit({ text: TEXT.replace("Parlò con Elio.", "Urlò.") }));
  assert.equal((await send(id, { type: "git_pull", mode: "author", consentAi: false })).result.state, "fast_forwarded");
  const started = await send(id, { type: "git_merge", from: "bozza", mode: "author", consentAi: false });
  assert.equal(started.result.state, "needs_resolution", JSON.stringify(started.result));
  const session = (await book()).mergeSession;
  assert.equal(session.kind, "branch"); assert.equal(session.oursBranch, "main"); assert.equal(session.theirsBranch, "bozza");
  await send(id, { type: "git_merge_resolve", mergeId: session.id, decisions: { [session.conflicts[0].id]: { choice: "ours" } } });
  const done = await send(id, { type: "git_merge_finish", mergeId: session.id });
  assert.equal(done.state, "completed", JSON.stringify(done.result));
  assert.match(await sceneText(), /Urlò/);
  const tip = await head("main");
  assert.equal((await parents(tip)).length, 2);
  assert.ok((await parents(tip)).includes(await head("bozza")));
  const again = await send(id, { type: "git_merge", from: "bozza", mode: "author", consentAi: false });
  assert.equal(again.result.state, "current", "an already merged branch is not merged twice");
}));

test("the autopilot merges the scene edited on both branches; consent is required; the result waits for the editorial review", skip, () => fixture(async ({ send, book, sceneText, external, head, parents, id, service, calls, client }) => {
  const { currentStamp } = await import("../dist/testing.mjs");
  await send(id, { type: "git_create_branch", name: "bozza", switchTo: true });
  const record = await service.store.read(id);
  await send(id, { type: "edit_scene", sceneId: "s:1", expectedStamp: currentStamp(record.book, { kind: "scene", id: "s:1" }), patch: { text: TEXT.replace("Parlò con Elio.", "Tacque.") } });
  await send(id, { type: "save_github", consentPublic: false });
  await send(id, { type: "git_switch_branch", branch: "main" });
  await external("main", edit({ text: TEXT.replace("Parlò con Elio.", "Urlò.") }));
  await send(id, { type: "git_pull", mode: "author", consentAi: false });
  await assert.rejects(send(id, { type: "git_merge", from: "bozza", mode: "autopilot", consentAi: false }));
  assert.equal(calls.ai, 0);
  const started = await send(id, { type: "git_merge", from: "bozza", mode: "autopilot", consentAi: true });
  assert.equal(started.result.state, "needs_resolution", JSON.stringify(started.result));
  await service.controller.waitForIdle();
  const state = await service.store.read(id);
  if (calls.ai !== 1) console.log("DEBUG", state.book.previousError, state.book.status, JSON.stringify(state.activities.map(a => [a.title, a.status, a.error])));
  assert.equal(calls.ai, 1);
  assert.equal(state.book.mergeSession, undefined, state.book.previousError);
  assert.equal(state.book.chapters[0].scenes[0].text, "Scena unita dall'autopilot.");
  assert.equal(state.book.chapters[0].scenes[0].status, "draft");
  assert.equal(state.book.chapters[0].frozenAt, undefined);
  assert.equal(state.book.remote.lastSyncedCommit, await head("main"));
  assert.equal((await parents(await head("main"))).length, 2);
  assert.ok(state.activities.some(a => /Unione dei branch/.test(a.title) && a.status === "succeeded" && a.aiRequested));
}, { ai: async body => {
  const prompt = body.messages.map(m => m.content).join("\n");
  assert.match(prompt, /NON ATTENDIBILE/);
  assert.match(prompt, /Tacque\./); assert.match(prompt, /Urlò\./);
  return "Scena unita dall'autopilot.";
} }));
