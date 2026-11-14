import { useEffect, useRef, useState } from "react";
import type { AppSettings, BookProject, GitHubRemote } from "../domain/types";
import { connectGitHubBook } from "../application/github-connect";
import { discoverGitHubRepositories, inspectGitHubSetup, type GitHubDestination, type GitHubRepository } from "../infrastructure/github-setup";
import { getBook } from "../infrastructure/db";
import { importGitHubBook, importGitHubMarkdownCopy } from "../infrastructure/github-sync";
import { githubPublicationBlocker } from "../domain/github-publication";
import { Button } from "./ui/button";

export function GitHubConnectionPicker({ book, token, request, onRefresh, onSelectBook, onNewBook, onConnected }: {
  book?: BookProject; token: AppSettings["githubToken"]; request: number;
  onRefresh: () => Promise<void>; onSelectBook: (id: string) => void;
  onNewBook: (remote?: GitHubRemote) => void;
  onConnected: () => void;
}) {
  const [repositories, setRepositories] = useState<GitHubRepository[]>();
  const [destination, setDestination] = useState<GitHubDestination>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const context = useRef({ bookId: book?.id, token });
  context.current = { bookId: book?.id, token };
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => {
    generation.current++;
    setRepositories(undefined); setDestination(undefined); setMessage(""); setBusy(false);
  }, [book?.id, token]);

  async function work(action: (isCurrent: () => boolean) => Promise<void>) {
    const ticket = ++generation.current;
    const identity = context.current;
    const isCurrent = () => mounted.current && ticket === generation.current &&
      identity.bookId === context.current.bookId && identity.token === context.current.token;
    setBusy(true); setMessage("");
    try { await action(isCurrent); }
    catch (error) { if (isCurrent()) setMessage(error instanceof Error ? error.message : "Collegamento GitHub non riuscito."); }
    finally { if (isCurrent()) setBusy(false); }
  }

  async function choose(repo: GitHubRepository, isCurrent: () => boolean) {
    const result = await inspectGitHubSetup(repo.remote);
    if (!isCurrent()) return;
    setDestination(result);
    if (result.kind === "divergent") {
      setMessage("I Markdown e lo snapshot BookWriter sono diversi o non confrontabili. Non verranno ignorati né applicati al libro aperto: puoi importarli come copia locale separata.");
      return;
    }
    if (result.kind === "book" || result.kind === "markdown") {
      const existing = await getBook(result.bookId);
      if (isCurrent()) setMessage(existing
        ? `«${result.title}» è già su questo dispositivo: puoi aprirlo.`
        : `Trovato «${result.title}»${result.kind === "markdown" ? " in formato Markdown" : ""}: puoi importarlo senza cambiare il libro aperto.`);
      return;
    }
    if (result.kind === "foreign") {
      setMessage("Questa repository contiene già dati di un libro non importabile. Non verranno sovrascritti.");
      return;
    }
    if (!book) return;
    if (book.remote && (book.remote.lastSyncedCommit || book.remote.owner !== result.remote.owner ||
      book.remote.repository !== result.remote.repository || book.remote.branch !== result.remote.branch)) return;
    const consent = result.private || window.confirm(
      `La repository ${result.remote.owner}/${result.remote.repository} è PUBBLICA. ` +
      "Una successiva sincronizzazione renderà visibili testo, trama e segreti. Autorizzi il collegamento?",
    );
    if (!consent || !isCurrent()) return;
    await connectGitHubBook(book.id, book.updatedAt, result.remote, !result.private, isCurrent);
    await onRefresh();
    if (isCurrent()) {
      // The use case has now verified an initialized destination. The original
      // preview ("empty") and any lease read from before the PUT are obsolete,
      // even when owner/repository/branch and book ID have not changed.
      setDestination({ ...result, kind: "available" });
      onConnected();
      setMessage(`Libro collegato a ${result.remote.owner}/${result.remote.repository}. Il manoscritto non è ancora stato pubblicato.` +
        (githubPublicationBlocker(book) ? " Il lavoro locale è conservato; completa la verifica editoriale prima della pubblicazione." : " Quando vuoi, usa Sincronizza."));
    }
  }

  const discover = () => work(async isCurrent => {
    setDestination(undefined);
    const all = await discoverGitHubRepositories();
    if (!isCurrent()) return;
    setRepositories(all);
    const writable = all.filter(repo => repo.canPush);
    // Only an unambiguous private destination; never guess from the book's name.
    if (writable.length === 1 && writable[0]!.private) await choose(writable[0]!, isCurrent);
    else setMessage(all.length ? "Scegli la repository del libro. Proprietario e ramo sono già compilati." :
      "Nessuna repository trovata. Crea una repository privata su GitHub e autorizzala nel PAT, poi cerca di nuovo.");
  });
  useEffect(() => { if (request > 0 && token) void discover(); }, [request]);

  return <section aria-label="Collegamento GitHub guidato" className="space-y-3">
    <div className="flex flex-wrap gap-2">
      <Button disabled={!token || busy} onClick={() => void discover()}>Trova le repository del PAT</Button>
      <Button variant="outline" disabled={!token || busy} onClick={() => onNewBook()}>Usa lo stesso PAT per un altro libro</Button>
    </div>
    {busy && <p role="status" className="muted text-sm">Verifica delle repository GitHub in corso…</p>}
    {repositories && <ul className="max-h-72 space-y-2 overflow-y-auto" aria-label="Repository trovate">
      {repositories.map(repo => <li key={repo.remote.owner + "/" + repo.remote.repository}
        className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-400/40 p-3 text-sm">
        <span className="min-w-0 [overflow-wrap:anywhere]"><b>{repo.remote.owner}/{repo.remote.repository}</b>
          <span className="muted block text-xs">{repo.private ? "Privata" : "PUBBLICA"} · {repo.remote.branch}{!repo.canPush && " · Solo lettura"}</span></span>
        <Button size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={() => void work(current => choose(repo, current))}>
          {book && !book.remote ? "Usa questa repository" : "Apri o importa"}
        </Button>
      </li>)}
    </ul>}
    {(destination?.kind === "book" || destination?.kind === "markdown") && <Button disabled={busy} onClick={() => void work(async isCurrent => {
      const existing = await getBook(destination.bookId);
      if (!isCurrent()) return;
      if (existing) { onSelectBook(existing.id); return; }
      const imported = await importGitHubBook(destination.remote, isCurrent, destination.head);
      if (!isCurrent()) return;
      await onRefresh();
      if (isCurrent()) onSelectBook(imported.id);
    })}>Apri o importa «{destination.title}»</Button>}
    {(destination?.kind === "divergent" || destination?.kind === "book") && <Button variant="outline" disabled={busy}
      onClick={() => void work(async isCurrent => {
        if (!window.confirm("Importare i soli Markdown in un nuovo libro locale separato? Il libro aperto e GitHub non cambiano. La copia non eredita freeze, giudizi, consensi AI o collegamento GitHub; controlla le impostazioni prima di riprendere.")) return;
        const imported = await importGitHubMarkdownCopy(destination.remote, destination.head, isCurrent);
        if (!isCurrent()) return;
        await onRefresh();
        if (isCurrent()) onSelectBook(imported.id);
      })}>Importa Markdown come copia separata</Button>}
    {destination?.kind === "markdown" && <p className="muted text-xs">Libro scritto a mano o con un'altra IA: importeremo capitoli, scene e schede senza nuove chiamate AI. Nessun freeze o giudizio editoriale viene dedotto da canon.</p>}
    {!book && destination && (destination.kind === "empty" || destination.kind === "available") &&
      <Button disabled={busy} onClick={() => onNewBook(destination.remote)}>Imposta un nuovo libro in questa repository</Button>}
    {destination?.kind === "empty" && <p className="muted text-xs">Repository vuota: al collegamento creiamo solo un file tecnico iniziale, senza testo del libro.</p>}
    {message && <p role="status" className="rounded-lg border border-amber-500/40 p-3 text-sm [overflow-wrap:anywhere]">{message}</p>}
  </section>;
}
