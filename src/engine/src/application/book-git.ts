import type { Activity, BookProject, GitHubRemote } from "../domain/types";
import {
  applyBookMerge, chooseMerge, isMergeReady, planBookMerge, toMergeConflicts, unresolvedConflicts,
  type MergeChoice, type MergeSession,
} from "../domain/book-merge";
import { host } from "../core/host";
import { BookNotFound, getBookForMutation, saveBook, withExclusiveLock } from "../core/store";
import { retryStamp } from "../core/retry-policy";
import { isReleasedBook } from "../domain/execution-authority";
import { narrativeStateJson } from "../core/narrative-state";
import { getRetrySchedule } from "../infrastructure/retry-schedule";
import {
  compareGitHubCommits, createGitHubBranch, deleteGitHubBranch, listGitHubBranches, pushGitHubBook, readGitHubBranchHead,
  readGitHubSnapshot, readGitHubSnapshotAt, RemoteConflict, validateRemote,
  type GitHubBranch, type RemoteBookSnapshot,
} from "../infrastructure/github-sync";

const BUSY = "Un'altra operazione sta usando questo libro: riprova più tardi.";
const bump = (previous: string) => new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
export const narrativeStamp = (book: BookProject): string => retryStamp(narrativeStateJson(book));
const isDirty = (book: BookProject) => book.remote?.lastSyncedLocalUpdatedAt !== book.updatedAt;

/** Branch, pull and merge change the same state the runner and the saves change: both locks, never concurrently. */
export function withBookGit<T>(bookId: string, action: () => Promise<T>): Promise<T> {
  return host().withBookScope(bookId, () => withExclusiveLock("bookwriter:writer:" + bookId, { busy: BUSY },
    () => withExclusiveLock("bookwriter:github-outbox", { busy: BUSY }, action)));
}

type Confirmed = BookProject & { remote: GitHubRemote & { lastSyncedCommit: string } };
async function load(bookId: string, allowSession = false): Promise<Confirmed> {
  const book = await getBookForMutation(bookId);
  if (!book) throw new BookNotFound();
  if (!book.remote?.lastSyncedCommit)
    throw new Error("Il libro non ha ancora una versione confermata su GitHub: esegui prima il primo salvataggio.");
  if (book.status === "running") throw new Error("Metti in pausa l'autopilot prima di operare sui branch.");
  if (book.mergeSession && !allowSession) throw new Error("Un'unione è in attesa di decisioni: concludila o annullala.");
  if (await host().readManualPushIntent(bookId))
    throw new RemoteConflict("Un salvataggio manuale precedente è ancora sospeso: risolvilo prima di cambiare branch.");
  if (await getRetrySchedule(bookId)) throw new Error("C'è una ripartenza programmata: annullala prima di operare sui branch.");
  return book as Confirmed;
}
const here = (book: Confirmed): GitHubRemote => ({ owner: book.remote.owner, repository: book.remote.repository, branch: book.remote.branch });
const onBranch = (book: Confirmed, branch: string): GitHubRemote => ({ ...here(book), branch });

function assertSameBook(local: BookProject, remote: BookProject): void {
  if (remote.id !== local.id) throw new RemoteConflict("La repository contiene un libro con ID differente: nessuna copia modificata.");
  const a = local.executionAuthority, b = remote.executionAuthority;
  if (a?.serverId !== b?.serverId || a?.epoch !== b?.epoch)
    throw new RemoteConflict("La versione remota non conferma la stessa autorità sul libro: nessuna modifica applicata.");
}
async function snapshotOf(remote: GitHubRemote, local: BookProject, signal?: AbortSignal): Promise<RemoteBookSnapshot> {
  const snapshot = await readGitHubSnapshot(remote, signal);
  if (!snapshot) throw new Error("Il branch «" + remote.branch + "» non contiene un libro BookWriter.");
  assertSameBook(local, snapshot.book);
  return snapshot;
}

/** The remote version becomes the book. Destination, sync policy and authority stay this host's; a consent is never switched on. */
function adopted(local: Confirmed, snapshot: RemoteBookSnapshot, branch: string, now: string): BookProject {
  const updatedAt = bump(Date.parse(snapshot.book.updatedAt) > Date.parse(local.updatedAt) ? snapshot.book.updatedAt : local.updatedAt);
  const next: BookProject = {
    ...snapshot.book, executionAuthority: local.executionAuthority, updatedAt,
    status: snapshot.book.status === "running" ? "paused" : snapshot.book.status,
    remote: { ...local.remote, branch, lastSyncedCommit: snapshot.head, lastSyncedLocalUpdatedAt: updatedAt, lastSyncAt: now },
  };
  delete next.mergeSession;
  if (snapshot.book.status === "running") next.previousError = "Il lavoro era in esecuzione su un altro dispositivo: riprendi quando vuoi.";
  if (next.webResearch?.enabled && !local.webResearch?.enabled) next.webResearch = { ...next.webResearch, enabled: false };
  return next;
}
async function adopt(bookId: string, local: Confirmed, snapshot: RemoteBookSnapshot, branch: string): Promise<void> {
  const next = adopted(local, snapshot, branch, new Date().toISOString());
  await host().transaction(bookId, record => {
    if (record.book.updatedAt !== local.updatedAt || record.book.status === "running" || record.outbox || record.manualPushIntent)
      throw new RemoteConflict("Il libro è cambiato durante l'operazione: nessuna modifica applicata. Riprova.");
    record.book = next;
    const known = new Set(record.activities.map(a => a.id));
    for (const activity of snapshot.activities) if (!known.has(activity.id))
      record.activities.push(activity.status === "running" ? { ...activity, status: "cancelled" as const } as Activity : activity);
  }, { activities: true });
}

export interface BranchList { current: string; baseline: string; dirty: boolean; branches: GitHubBranch[] }
export async function listBookBranches(bookId: string): Promise<BranchList> {
  return host().withBookScope(bookId, async () => {
    const book = await getBookForMutation(bookId);
    if (!book?.remote) throw new Error("Collega prima il libro a una repository GitHub.");
    return { current: book.remote.branch, baseline: book.remote.lastSyncedCommit ?? "", dirty: isDirty(book),
      branches: await listGitHubBranches(book.remote) };
  });
}

export type MergeOutcome =
  | { state: "current" | "fast_forwarded" | "merged"; commit: string }
  | { state: "needs_resolution"; mergeId: string; conflicts: number };

interface MergeSpec {
  kind: MergeSession["kind"]; mode: MergeSession["mode"]; oursBranch: string; theirsBranch: string;
  oursCommit: string; theirsCommit: string; baseCommit?: string; expectedHead: string; theirs: RemoteBookSnapshot; base?: BookProject;
}
const mergeNote = (spec: Pick<MergeSpec, "oursBranch" | "theirsBranch">) =>
  `Unione di «${spec.theirsBranch}» in «${spec.oursBranch}»: i capitoli toccati sono riaperti, controllali prima di riprendere l'autopilot.`;

/** Store the merged book (clearing any session), then publish it as a merge commit. A failed publication
 * leaves the merged book queued: the next save or pull derives the same merge again, never a lost one. */
async function publishMerge(bookId: string, local: BookProject, merged: BookProject, spec: MergeSpec): Promise<string> {
  merged.id = local.id; merged.remote = local.remote; merged.executionAuthority = local.executionAuthority;
  delete merged.mergeSession;
  await saveBook(merged, true, local.updatedAt);
  const result = await pushGitHubBook(bookId, local.remote?.allowPublicSync === true, {
    merge: { oursParent: spec.oursCommit, theirsParent: spec.theirsCommit, expectedHead: spec.expectedHead },
  });
  return result.commit;
}

async function mergeVersions(bookId: string, local: Confirmed, spec: MergeSpec): Promise<MergeOutcome> {
  const plan = planBookMerge(local, spec.theirs.book, spec.base);
  if (plan.conflicts.length === 0) {
    const merged = applyBookMerge(local, spec.theirs.book, plan, [], mergeNote(spec));
    return { state: "merged", commit: await publishMerge(bookId, local, merged, spec) };
  }
  const session: MergeSession = {
    id: crypto.randomUUID(), kind: spec.kind, mode: spec.mode, oursBranch: spec.oursBranch, theirsBranch: spec.theirsBranch,
    oursCommit: spec.oursCommit, theirsCommit: spec.theirsCommit, ...(spec.baseCommit ? { baseCommit: spec.baseCommit } : {}),
    oursStamp: narrativeStamp(local), createdAt: new Date().toISOString(), conflicts: toMergeConflicts(plan, spec.base),
  };
  await host().transaction(bookId, record => {
    if (record.book.updatedAt !== local.updatedAt || record.book.status === "running")
      throw new RemoteConflict("Il libro è cambiato durante il confronto: nessuna unione avviata. Riprova.");
    record.book.mergeSession = session; record.book.status = "paused";
    record.book.previousError = `Unione di «${spec.theirsBranch}» in «${spec.oursBranch}»: ${session.conflicts.length} conflitti da decidere.`;
  });
  return { state: "needs_resolution", mergeId: session.id, conflicts: session.conflicts.length };
}
async function baseOf(local: Confirmed, commit: string | null): Promise<BookProject | undefined> {
  if (!commit) return undefined;
  const base = await readGitHubSnapshotAt(here(local), commit);
  if (!base || base.book.id !== local.id) return undefined;
  return base.book;
}

/** Bring in what the repository has that this book does not. Fast-forward when nothing was changed here,
 * otherwise a three-way merge against the common ancestor. */
export function pullBook(bookId: string, options: { mode?: MergeSession["mode"]; signal?: AbortSignal } = {}): Promise<MergeOutcome> {
  return withBookGit(bookId, () => pullLocked(bookId, options));
}
async function pullLocked(bookId: string, options: { mode?: MergeSession["mode"]; signal?: AbortSignal }): Promise<MergeOutcome> {
  const local = await load(bookId);
  const baseline = local.remote.lastSyncedCommit;
  // A light read first: most of the time nothing moved and the whole snapshot need not be fetched.
  const tip = await readGitHubBranchHead(here(local), options.signal);
  if (tip === null) throw new RemoteConflict("Il branch «" + local.remote.branch + "» non esiste più su GitHub: nessuna modifica applicata.");
  if (tip === baseline) return { state: "current", commit: baseline };
  const snapshot = await snapshotOf(here(local), local, options.signal);
  if (snapshot.head === baseline) return { state: "current", commit: baseline };
  const cmp = await compareGitHubCommits(here(local), baseline, snapshot.head, options.signal);
  if (cmp.status === "identical" || cmp.status === "behind")
    throw new RemoteConflict("Il branch GitHub è tornato indietro rispetto all'ultima versione sincronizzata: nessuna modifica applicata.");
  if (cmp.status === "ahead" && !isDirty(local) && !await host().readOutbox(bookId)) {
    await adopt(bookId, local, snapshot, local.remote.branch);
    return { state: "fast_forwarded", commit: snapshot.head };
  }
  return mergeVersions(bookId, local, {
    kind: "pull", mode: options.mode ?? "author", oursBranch: local.remote.branch, theirsBranch: local.remote.branch,
    oursCommit: baseline, theirsCommit: snapshot.head, baseCommit: cmp.mergeBase ?? undefined, expectedHead: snapshot.head,
    theirs: snapshot, base: await baseOf(local, cmp.mergeBase),
  });
}

/**
 * The server gives the book back. Everything is saved first (what others pushed is merged, conflicts stop it),
 * then a commit without the authority marker is published; only after that the server stops running the book.
 */
export function releaseBookToClient(bookId: string): Promise<{ commit: string }> {
  return withBookGit(bookId, async () => {
    const before = await load(bookId);
    if (!before.executionAuthority || isReleasedBook(before)) throw new Error("Il libro non è affidato a questo server o è già stato rilasciato.");
    if ((await pullLocked(bookId, { mode: "author" })).state === "needs_resolution")
      throw new RemoteConflict("Ci sono conflitti da decidere: concludi o annulla l'unione prima di rilasciare il libro.");
    const local = await load(bookId);
    const result = await pushGitHubBook(bookId, local.remote.allowPublicSync === true, { release: true });
    await host().transaction(bookId, record => {
      const authority = record.book.executionAuthority;
      if (!authority || record.book.status === "running") throw new RemoteConflict("Il libro è cambiato durante il rilascio.");
      record.book.executionAuthority = { ...authority, releasedAt: new Date().toISOString(), releasedCommit: result.commit };
      record.book.status = "paused";
      record.book.previousError = "Libro rilasciato al client: la repository non nomina più il server e qui non viene più eseguito.";
      if (record.book.remote) record.book.remote = { ...record.book.remote, autoSync: false };
      delete record.outbox; delete record.retrySchedule;
    });
    return { commit: result.commit };
  });
}

/** Another branch of the same repository becomes the book. Unsaved edits are never replaced. */
export function switchBranch(bookId: string, branch: string): Promise<{ branch: string; commit: string }> {
  return withBookGit(bookId, async () => {
    const local = await load(bookId);
    const target = validateRemote({ ...here(local), branch }).branch;
    if (target === local.remote.branch) return { branch: target, commit: local.remote.lastSyncedCommit };
    if (isDirty(local) || await host().readOutbox(bookId))
      throw new RemoteConflict("Il libro ha modifiche non salvate su GitHub: salvale (o crea il branch da qui) prima di cambiare branch.");
    const snapshot = await snapshotOf(onBranch(local, target), local);
    await adopt(bookId, local, snapshot, target);
    return { branch: target, commit: snapshot.head };
  });
}

/** `from` defaults to the current branch. Creating from the current branch and switching keeps unsaved
 * edits (like `git checkout -b`); creating from another branch and switching needs a clean book. */
export function createBranch(bookId: string, input: { name: string; from?: string; switchTo?: boolean }): Promise<{ branch: string; commit: string; switched: boolean }> {
  return withBookGit(bookId, async () => {
    const local = await load(bookId);
    const name = validateRemote({ ...here(local), branch: input.name }).branch;
    const from = input.from ? validateRemote({ ...here(local), branch: input.from }).branch : local.remote.branch;
    const fromCurrent = from === local.remote.branch;
    let commit = local.remote.lastSyncedCommit;
    if (!fromCurrent) {
      const head = await readGitHubBranchHead(onBranch(local, from));
      if (!head) throw new Error("Il branch di partenza «" + from + "» non esiste.");
      commit = head;
    }
    if (input.switchTo && !fromCurrent && (isDirty(local) || await host().readOutbox(bookId)))
      throw new RemoteConflict("Il libro ha modifiche non salvate: crea il branch dal branch corrente oppure salva prima.");
    await createGitHubBranch(onBranch(local, name), commit);
    if (!input.switchTo) return { branch: name, commit, switched: false };
    if (fromCurrent) {
      await host().transaction(bookId, record => {
        if (record.book.updatedAt !== local.updatedAt || record.book.status === "running" || !record.book.remote)
          throw new RemoteConflict("Il libro è cambiato durante l'operazione: il branch è stato creato ma non selezionato.");
        record.book.remote = { ...record.book.remote, branch: name };
      });
    } else await adopt(bookId, local, await snapshotOf(onBranch(local, name), local), name);
    return { branch: name, commit, switched: true };
  });
}

/** Delete a branch, only when everything it holds is already in the current branch (like `git branch -d`). */
export function deleteBranch(bookId: string, branch: string): Promise<{ deleted: string; commit: string }> {
  return withBookGit(bookId, async () => {
    const local = await load(bookId);
    const target = validateRemote({ ...here(local), branch }).branch;
    if (target === local.remote.branch) throw new Error("Il branch corrente non si elimina: passa prima a un altro branch.");
    const tip = await readGitHubBranchHead(onBranch(local, target));
    if (!tip) throw new Error("Il branch «" + target + "» non esiste.");
    const cmp = await compareGitHubCommits(here(local), local.remote.lastSyncedCommit, tip);
    if (cmp.status !== "identical" && cmp.status !== "behind")
      throw new RemoteConflict("Il branch «" + target + "» ha modifiche che non sono in «" + local.remote.branch + "»: uniscilo prima, poi eliminalo.");
    await deleteGitHubBranch(onBranch(local, target));
    return { deleted: target, commit: tip };
  });
}

/** Merge another branch into the current one. Nothing is published until every conflict has a decision. */
export function startBranchMerge(bookId: string, input: { from: string; mode?: MergeSession["mode"] }): Promise<MergeOutcome> {
  return withBookGit(bookId, async () => {
    const local = await load(bookId);
    const from = validateRemote({ ...here(local), branch: input.from }).branch;
    if (from === local.remote.branch) throw new Error("Scegli un branch diverso da quello corrente.");
    const baseline = local.remote.lastSyncedCommit;
    if (await readGitHubBranchHead(here(local)) !== baseline)
      throw new RemoteConflict("Il branch corrente è cambiato su GitHub: esegui prima l'aggiornamento (pull).");
    const snapshot = await snapshotOf(onBranch(local, from), local);
    const cmp = await compareGitHubCommits(here(local), baseline, snapshot.head);
    if (cmp.status === "identical" || cmp.status === "behind") return { state: "current", commit: baseline };
    return mergeVersions(bookId, local, {
      kind: "branch", mode: input.mode ?? "author", oursBranch: local.remote.branch, theirsBranch: from,
      oursCommit: baseline, theirsCommit: snapshot.head, baseCommit: cmp.mergeBase ?? undefined, expectedHead: baseline,
      theirs: snapshot, base: await baseOf(local, cmp.mergeBase),
    });
  });
}

/** The author's decisions; unknown ids and proposals on anything but a text unit present on both sides are refused. */
export function resolveMerge(bookId: string, mergeId: string, decisions: Record<string, { choice: MergeChoice; proposal?: string }>): Promise<{ unresolved: number }> {
  return withBookGit(bookId, async () => {
    const local = await load(bookId, true);
    const session = local.mergeSession;
    if (!session || session.id !== mergeId) throw new Error("Questa unione non è più attuale.");
    const next = structuredClone(session);
    for (const [id, decision] of Object.entries(decisions)) chooseMerge(next, id, decision.choice, decision.proposal);
    await host().transaction(bookId, record => {
      if (record.book.mergeSession?.id !== mergeId || narrativeStamp(record.book) !== session.oursStamp)
        throw new RemoteConflict("Il libro è cambiato durante l'unione: annullala e ripetila.");
      record.book.mergeSession = next;
      record.book.previousError = isMergeReady(next) ? "Unione pronta: conferma per pubblicarla."
        : `Unione di «${next.theirsBranch}» in «${next.oursBranch}»: ${unresolvedConflicts(next).length} conflitti da decidere.`;
    });
    return { unresolved: unresolvedConflicts(next).length };
  });
}

export function abortMerge(bookId: string, mergeId: string): Promise<void> {
  return withBookGit(bookId, async () => {
    await host().transaction(bookId, record => {
      if (record.book.mergeSession?.id !== mergeId) throw new Error("Questa unione non è più attuale.");
      delete record.book.mergeSession;
      record.book.previousError = "Unione annullata: il libro è rimasto com'era.";
    });
  });
}

/** Publish a fully decided merge. The branches must be exactly where they were when the merge started. */
export function finishMerge(bookId: string): Promise<{ commit: string }> {
  return withBookGit(bookId, async () => {
    const local = await load(bookId, true);
    const session = local.mergeSession;
    if (!session) throw new Error("Nessuna unione in corso.");
    if (!isMergeReady(session)) throw new Error("Restano conflitti senza decisione.");
    if (narrativeStamp(local) !== session.oursStamp) throw new RemoteConflict("Il libro è cambiato durante l'unione: annullala e ripetila.");
    const destination = await readGitHubBranchHead(here(local));
    const expectedHead = session.kind === "pull" ? session.theirsCommit : session.oursCommit;
    if (destination !== expectedHead || local.remote.lastSyncedCommit !== session.oursCommit)
      throw new RemoteConflict("Il branch è cambiato su GitHub durante l'unione: annullala e ripetila.");
    if (session.kind === "branch" && await readGitHubBranchHead(onBranch(local, session.theirsBranch)) !== session.theirsCommit)
      throw new RemoteConflict("Il branch «" + session.theirsBranch + "» è cambiato durante l'unione: annullala e ripetila.");
    const theirs = await readGitHubSnapshotAt(here(local), session.theirsCommit);
    if (!theirs) throw new Error("Versione da unire non più leggibile.");
    assertSameBook(local, theirs.book);
    const base = await baseOf(local, session.baseCommit ?? null);
    const clean = { ...local } as BookProject; delete clean.mergeSession;
    const plan = planBookMerge(clean, theirs.book, base);
    const ids = new Set(plan.conflicts.map(c => c.id));
    if (ids.size !== session.conflicts.length || session.conflicts.some(c => !ids.has(c.id)))
      throw new RemoteConflict("I conflitti non corrispondono più alle versioni: annulla l'unione e ripetila.");
    const merged = applyBookMerge(clean, theirs.book, plan, session.conflicts, mergeNote(session));
    const commit = await publishMerge(bookId, local, merged, {
      kind: session.kind, mode: session.mode, oursBranch: session.oursBranch, theirsBranch: session.theirsBranch,
      oursCommit: session.oursCommit, theirsCommit: session.theirsCommit, expectedHead, theirs, base,
    });
    return { commit };
  });
}
