import type { GitHubGitCall, GitHubGitTransport } from "../core/host";
import { gitBlobSha } from "../infrastructure/github-markdown";

interface MemoryCommit { sha: string; tree: string; parents: string[]; message: string; seq: number }
const toBase64 = (text: string) => { const bytes = new TextEncoder().encode(text); let binary = ""; for (const b of bytes) binary += String.fromCharCode(b); return btoa(binary); };
const ok = (json: unknown, status = 200) => ({ status, json });
const missing = () => ({ status: 404, json: { message: "Not Found" } });
const hex = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text))), n => n.toString(16).padStart(2, "0")).join("");

/**
 * A whole repository in memory behind the Git Data port: what the engine flows (push, pull, branches,
 * merges) need, with real blob SHAs and real fast-forward rules. For tests of any host; it knows no network.
 */
export class MemoryGitHub implements GitHubGitTransport {
  readonly refs = new Map<string, string>();
  readonly commits = new Map<string, MemoryCommit>();
  private readonly trees = new Map<string, Map<string, string>>();
  private readonly blobs = new Map<string, string>();
  private counter = 0;
  isPrivate = true; canPush = true; failPush = false;
  readonly calls: Array<{ method: string; path: string }> = [];

  private async tree(files: Map<string, string>): Promise<string> {
    const sha = await hex("tree\n" + JSON.stringify([...files].sort()));
    this.trees.set(sha, files); return sha;
  }
  private async blob(content: string): Promise<string> {
    const sha = await gitBlobSha(content); this.blobs.set(sha, content); return sha;
  }
  private treeOf(sha: string): Map<string, string> | undefined {
    const commit = this.commits.get(sha);
    return this.trees.get(commit ? commit.tree : sha);
  }
  private async makeCommit(tree: string, parents: string[], message: string): Promise<string> {
    const seq = ++this.counter;
    const sha = await hex(`commit\n${tree}\n${parents.join(",")}\n${message}\n${seq}`);
    this.commits.set(sha, { sha, tree, parents, message, seq }); return sha;
  }
  ancestors(sha: string): Set<string> {
    const seen = new Set<string>(), stack = [sha];
    while (stack.length) { const next = stack.pop()!; if (seen.has(next)) continue; seen.add(next); stack.push(...(this.commits.get(next)?.parents ?? [])); }
    return seen;
  }
  /** Test helper: a commit holding `files` over the tree of `from` (default: the branch tip); `null` removes a file. */
  async commit(branch: string, files: Record<string, string | null>, options: { from?: string; parents?: string[]; message?: string; move?: boolean } = {}): Promise<string> {
    const from = options.from ?? this.refs.get(branch);
    const tree = new Map(from ? this.treeOf(from) : []);
    for (const [path, content] of Object.entries(files)) {
      if (content === null) tree.delete(path); else tree.set(path, await this.blob(content));
    }
    const sha = await this.makeCommit(await this.tree(tree), options.parents ?? (from ? [from] : []), options.message ?? "commit di prova");
    if (options.move !== false) this.refs.set(branch, sha);
    return sha;
  }
  file(ref: string, path: string): string | undefined {
    const blob = this.treeOf(this.refs.get(ref) ?? ref)?.get(path);
    return blob === undefined ? undefined : this.blobs.get(blob);
  }

  async handle(call: GitHubGitCall): Promise<{ status: number; json: unknown } | undefined> {
    const url = new URL(call.path, "https://api.github.com");
    this.calls.push({ method: call.method, path: url.pathname });
    const match = /^\/repos\/[^/]+\/[^/]+(\/.*)?$/.exec(url.pathname);
    if (!match) return undefined;
    const rest = decodeURIComponent(match[1] ?? ""), method = call.method;
    const query = url.searchParams;
    if (rest === "" && method === "GET")
      return ok({ private: this.isPrivate, default_branch: "main", permissions: { push: this.canPush }, full_name: "demo/libro" });
    let m: RegExpExecArray | null;
    if ((m = /^\/git\/ref\/heads\/(.+)$/.exec(rest)) && method === "GET") {
      const sha = this.refs.get(m[1]!); return sha ? ok({ object: { sha } }) : missing();
    }
    if ((m = /^\/contents\/(.+)$/.exec(rest)) && method === "GET") {
      const ref = query.get("ref") ?? "main";
      const blob = this.treeOf(this.refs.get(ref) ?? ref)?.get(m[1]!);
      return blob === undefined ? missing() : ok({ type: "file", encoding: "base64", content: toBase64(this.blobs.get(blob)!), sha: blob });
    }
    if ((m = /^\/git\/commits\/([0-9a-f]{40})$/.exec(rest)) && method === "GET") {
      const commit = this.commits.get(m[1]!);
      return commit ? ok({ sha: commit.sha, message: commit.message, tree: { sha: commit.tree }, parents: commit.parents.map(sha => ({ sha })) }) : missing();
    }
    if (rest === "/commits" && method === "GET") {
      const start = query.get("sha") ?? "", size = Math.min(100, Number(query.get("per_page") ?? 30)), page = Number(query.get("page") ?? 1);
      if (!this.commits.has(start)) return missing();
      const list = [...this.ancestors(start)].map(sha => this.commits.get(sha)!).sort((a, b) => b.seq - a.seq);
      return ok(list.slice((page - 1) * size, page * size).map(c => ({ sha: c.sha })));
    }
    if ((m = /^\/git\/trees\/(.+)$/.exec(rest)) && method === "GET") {
      const tree = this.treeOf(this.refs.get(m[1]!) ?? m[1]!);
      if (!tree) return missing();
      return ok({ sha: m[1], truncated: false, tree: [...tree].map(([path, sha]) => ({ path, mode: "100644", type: "blob", sha, size: this.blobs.get(sha)!.length })) });
    }
    if ((m = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(rest)) && method === "GET") {
      const content = this.blobs.get(m[1]!);
      return content === undefined ? missing() : ok({ sha: m[1], encoding: "base64", content: toBase64(content), size: content.length });
    }
    if (rest === "/git/trees" && method === "POST") {
      const body = call.body as { base_tree?: string; tree: Array<{ path: string; content?: string; sha?: null }> };
      const tree = new Map(body.base_tree ? this.treeOf(body.base_tree) : []);
      for (const entry of body.tree) {
        if (entry.sha === null) tree.delete(entry.path); else tree.set(entry.path, await this.blob(entry.content ?? ""));
      }
      return ok({ sha: await this.tree(tree) }, 201);
    }
    if (rest === "/git/commits" && method === "POST") {
      const body = call.body as { message: string; tree: string; parents: string[] };
      if (!this.trees.has(body.tree) || body.parents.some(p => !this.commits.has(p))) return { status: 422, json: {} };
      return ok({ sha: await this.makeCommit(body.tree, body.parents, body.message) }, 201);
    }
    if ((m = /^\/git\/refs\/heads\/(.+)$/.exec(rest)) && method === "PATCH") {
      const body = call.body as { sha: string; force?: boolean };
      const current = this.refs.get(m[1]!);
      if (body.force !== false || !current || !this.commits.has(body.sha) || this.failPush) return { status: 422, json: {} };
      if (!this.ancestors(body.sha).has(current)) return { status: 422, json: { message: "Update is not a fast forward" } };
      this.refs.set(m[1]!, body.sha); return ok({ object: { sha: body.sha } });
    }
    if (rest === "/git/refs" && method === "POST") {
      const body = call.body as { ref: string; sha: string };
      const name = body.ref.replace(/^refs\/heads\//, "");
      if (!body.ref.startsWith("refs/heads/") || this.refs.has(name) || !this.commits.has(body.sha)) return { status: 422, json: {} };
      this.refs.set(name, body.sha); return ok({ object: { sha: body.sha } }, 201);
    }
    if (rest === "/branches" && method === "GET")
      return ok([...this.refs].sort(([a], [b]) => a.localeCompare(b)).map(([name, sha]) => ({ name, commit: { sha } })));
    if ((m = /^\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/.exec(rest)) && method === "GET") {
      const a = m[1]!, b = m[2]!;
      if (!this.commits.has(a) || !this.commits.has(b)) return missing();
      const left = this.ancestors(a), right = this.ancestors(b);
      const common = [...left].filter(sha => right.has(sha));
      const best = common.filter(sha => !common.some(other => other !== sha && this.ancestors(other).has(sha)))
        .sort((x, y) => this.commits.get(y)!.seq - this.commits.get(x)!.seq)[0];
      const status = a === b ? "identical" : left.has(b) ? "behind" : right.has(a) ? "ahead" : "diverged";
      return ok({ status, ahead_by: [...right].filter(sha => !left.has(sha)).length, behind_by: [...left].filter(sha => !right.has(sha)).length,
        merge_base_commit: best ? { sha: best } : null });
    }
    return undefined;
  }
}
