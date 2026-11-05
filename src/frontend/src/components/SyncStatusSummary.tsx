import { useEffect, useState } from "react";
import { Cloud, CloudAlert, CheckCircle2, CloudUpload } from "lucide-react";
import type { BookProject, SyncOutboxItem } from "../domain/types";
import { getOutbox } from "../infrastructure/outbox";
import { Button } from "./ui/button";

export function SyncStatusSummary({
  book, openArchive,
}: { book: BookProject; openArchive: () => void }) {
  const [queued, setQueued] = useState<SyncOutboxItem | undefined>();
  useEffect(() => {
    let mounted = true;
    const update = () => {
      void getOutbox(book.id).then(item => { if (mounted) setQueued(item); }).catch(() => undefined);
    };
    update();
    const timer = window.setInterval(update, 5000);
    return () => { mounted = false; clearInterval(timer); };
  }, [book.id, book.updatedAt]);

  const remote = book.remote;
  const changed = !!remote && remote.lastSyncedLocalUpdatedAt !== book.updatedAt;
  let status = !remote ? "Nessuna repository collegata" :
    !remote.autoSync ? "Sincronizzazione manuale" :
    queued?.state === "blocked" ? "Sincronizzazione bloccata" :
    queued?.state === "syncing" ? "Invio checkpoint a GitHub" :
    queued ? "Checkpoint in coda per GitHub" :
    changed ? "Modifiche locali non ancora inviate" :
    "Checkpoint sincronizzato";

  const Icon = queued?.state === "blocked" ? CloudAlert :
    queued ? CloudUpload : remote?.lastSyncedCommit ? CheckCircle2 : Cloud;

  return <div className="space-y-3 text-sm" role="status" aria-live="polite">
    <p className="flex items-center gap-2 font-semibold"><Icon size={19} className={queued?.state === "blocked" ? "text-red-500" : "text-emerald-500"}/>{status}</p>
    {remote && <>
      <p className="muted text-xs">{remote.owner}/{remote.repository} · branch {remote.branch}</p>
      {remote.lastSyncedCommit && <p className="muted text-xs">Ultimo commit GitHub: {remote.lastSyncedCommit.slice(0, 12)}</p>}
      {remote.lastSyncAt && <p className="muted text-xs">Ultimo salvataggio: {new Date(remote.lastSyncAt).toLocaleString("it-IT")}</p>}
    </>}
    {queued?.lastError && <p className="text-xs text-red-600 dark:text-red-300">{queued.lastError}</p>}
    <Button variant="outline" onClick={openArchive}>Apri Archivio e sincronizzazione</Button>
    <p className="muted text-xs">L'autosync opera solo con il browser aperto e non coordina ancora gli autopilot fra dispositivi diversi.</p>
  </div>;
}
