import { useEffect, useState } from "react";
import type { BookProject } from "@engine/domain/types";
import type { ServerCommand } from "@engine/domain/personal-server";
import { personalServerConnection, reconcileServerCommand, sendServerCommand, syncServerBook } from "../infrastructure/personal-server-client";
import { Button } from "./ui/button";
import { exportDocx, exportEpub, exportPdf } from "../infrastructure/export-book";
import { pendingPersonalServerHandoff } from "../infrastructure/personal-server-handoff";

export function PersonalServerBookPanel({ book, onChanged }: { book: BookProject; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [owner, setOwner] = useState("");
  const [repository, setRepository] = useState("");
  const [branch, setBranch] = useState("main");
  const [handoffPending, setHandoffPending] = useState(false);
  useEffect(() => {
    let mounted = true;
    void pendingPersonalServerHandoff(book.id).then(value => { if (mounted) setHandoffPending(!!value); }).catch(() => { if (mounted) setHandoffPending(true); });
    return () => { mounted = false; };
  }, [book.id, book.updatedAt]);
  const act = (action: () => unknown | Promise<unknown>) => {
    setBusy(true); setNotice("");
    void Promise.resolve().then(action).catch(error => setNotice(error instanceof Error ? error.message : "Operazione remota non confermata."))
      .finally(async () => { await onChanged().catch(() => undefined); setBusy(false); });
  };
  const command = (value: ServerCommand) => act(async () => {
    await sendServerCommand(book.id, value);
    setNotice("Comando ricevuto dal server; l'accettazione non certifica la fine del task o un salvataggio GitHub.");
  });
  const reconcile = (cancelUnreceived = false) => act(async () => {
    const result = await reconcileServerCommand(book.id, { cancelUnreceived });
    setNotice(`Ricevute concluse: ${result.completed}; ancora accettate: ${result.accepted}; esito incerto: ${result.uncertain}; ` +
      `annullate prima dell'esecuzione: ${result.cancelled}; non completate: ${result.failed}. Nessun comando rieseguito.`);
  });
  return <section className="panel mb-4 min-w-0 space-y-3 p-4" aria-label="Libro sul server personale">
    <h2 className="font-semibold">Libro sul server personale · replica locale</h2>
    <p className="muted break-all text-sm">Autorità {book.executionAuthority?.serverId}. La replica permette lettura offline; disconnessione e timeout non autorizzano un secondo runner. Controlli remoti ancora sperimentali.</p>
    {handoffPending && <p role="status" className="text-sm">Trasferimento al server non concluso: apri Impostazioni → Server personale per riprendere l'invio, verificare la ricezione o annullarlo. Finché non è confermato i comandi restano disabilitati.</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={busy || handoffPending || book.status === "running"} onClick={() => command({ type: "start" })}>Avvia sul server</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => command({ type: "pause" })}>Pausa sul server</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => command({ type: "stop_after_task" })}>Ferma il server a fine task</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => act(async () => {
        const connection = await personalServerConnection(); if (!connection) throw new Error("Server scollegato: replica non aggiornata.");
        await syncServerBook(connection, book.id); setNotice("Replica confermata dal server.");
      })}>Aggiorna replica</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => reconcile()}>Verifica esito comando</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => {
        if (window.confirm("Verificare le richieste precedenti e annullare soltanto quelle non ancora ricevute dal server? Verrà registrato un rifiuto durevole degli invii tardivi. Un comando già accettato NON viene annullato né ripetuto; per fermare il lavoro usa Pausa."))
          reconcile(true);
      }}>Annulla richieste non ricevute</Button>
      {book.remote && <Button type="button" variant="outline" disabled={busy} onClick={() => command({ type: "save_github", consentPublic: false })}>Salva su GitHub dal server</Button>}
      {book.remote && <Button type="button" variant="outline" disabled={busy || book.status === "running"} onClick={() => command({ type: "set_autosync", enabled: !book.remote?.autoSync })}>{book.remote.autoSync ? "Disattiva autosync server" : "Attiva autosync server"}</Button>}
      <Button type="button" variant="outline" disabled={busy} onClick={() => command({ type: "cancel_retry" })}>Annulla retry sul server</Button>
    </div>
    {notice && <p role="status" className="break-words text-sm">{notice}</p>}
    <p className="muted text-sm">In questa tranche gli editor e i controlli storici del browser non modificano le repliche. I task del server non creano copie testuali pre/post sul dispositivo.</p>
    {!book.remote && <details><summary>Collega GitHub dal server</summary>
      <p className="muted my-2 text-sm">Delega prima il PAT da Impostazioni → Server personale. Usa una repository privata già inizializzata, senza un libro preesistente. Il server gestirà lease e salvataggi; il primo push resta esplicito.</p>
      <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (window.confirm("Verificare questa repository con il PAT delegato e collegarla al libro? Non verrà eseguito un push.")) command({ type: "connect_github", owner, repository, branch, consentPublic: false }); }}>
        <label className="block">Proprietario GitHub<input className="field" required value={owner} onChange={e => setOwner(e.target.value)}/></label>
        <label className="block">Repository GitHub<input className="field" required value={repository} onChange={e => setRepository(e.target.value)}/></label>
        <label className="block">Ramo GitHub<input className="field" required value={branch} onChange={e => setBranch(e.target.value)}/></label>
        <Button type="submit" disabled={busy}>Verifica e collega dal server</Button>
      </form>
    </details>}
    <details><summary>Manoscritto dell’ultima replica confermata</summary>
      {book.chapters.map(chapter => <article key={chapter.id} className="mt-4 min-w-0">
        <h3 className="font-semibold">Cap. {chapter.number} · {chapter.title}</h3>
        {chapter.scenes.map(scene => <section key={scene.id} className="my-3 min-w-0">
          <h4 className="font-medium">{scene.number}. {scene.title} · {scene.status}</h4>
          <p className="whitespace-pre-wrap break-words">{scene.text}</p>
        </section>)}
      </article>)}
    </details>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={busy} onClick={() => act(() => exportEpub(book))}>Esporta replica EPUB</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => act(() => exportDocx(book))}>Esporta replica DOCX</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => act(() => exportPdf(book))}>Esporta replica PDF</Button>
    </div>
  </section>;
}
