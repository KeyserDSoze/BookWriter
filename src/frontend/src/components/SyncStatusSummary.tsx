import { Cloud, CloudAlert, CheckCircle2, CloudUpload } from "lucide-react";
import type { BookProject } from "../domain/types";
import { useGitHubSave } from "../application/use-github-save";
import { Button } from "./ui/button";

export function SyncStatusSummary({
  book, openArchive, onSaved,
}: { book: BookProject; openArchive: () => void; onSaved?: () => void | Promise<void> }) {
  const { active, queued, saving, message, blocker, saveNow } = useGitHubSave(book, onSaved ?? (() => undefined));
  const remote = book.remote;
  const changed = !!remote && remote.lastSyncedLocalUpdatedAt !== book.updatedAt;
  const status = !remote ? "Nessuna repository collegata" :
    !remote.lastSyncedCommit ? "Collegato a GitHub, non ancora salvato" :
    !remote.autoSync ? (changed ? "Modifiche locali non ancora su GitHub" : "GitHub ha l'ultima versione") :
    queued?.state === "blocked" ? "Sincronizzazione bloccata" :
    queued?.state === "syncing" ? "Salvataggio su GitHub in corso" :
    queued ? "Salvataggio su GitHub in coda" :
    changed ? "Modifiche locali non ancora inviate" :
    "Checkpoint sincronizzato";

  const Icon = queued?.state === "blocked" ? CloudAlert :
    queued ? CloudUpload : remote?.lastSyncedCommit && !changed ? CheckCircle2 : Cloud;

  return <div className="space-y-3 text-sm" role="status" aria-live="polite">
    <p className="flex items-center gap-2 font-semibold"><Icon size={19} className={queued?.state === "blocked" ? "text-red-500" : "text-emerald-500"}/>{status}</p>
    {remote && <>
      <p className="muted text-xs">{remote.owner}/{remote.repository} · branch {remote.branch}</p>
      {remote.lastSyncedCommit && <p className="muted text-xs">Ultimo commit GitHub: {remote.lastSyncedCommit.slice(0, 12)}</p>}
      {remote.lastSyncAt && <p className="muted text-xs">Ultimo salvataggio: {new Date(remote.lastSyncAt).toLocaleString("it-IT")}</p>}
    </>}
    {queued?.lastError && <p className="text-xs text-red-600 dark:text-red-300">{queued.lastError}</p>}
    {blocker && remote && <p className="text-xs text-amber-700 dark:text-amber-300">{blocker}</p>}
    {message && <p className="rounded-lg border border-amber-500/40 p-2 text-xs">{message}</p>}
    <div className="flex flex-wrap gap-2">
      {active && <Button disabled={saving || !!blocker} onClick={() => void saveNow()}>
        <CloudUpload size={17}/> {saving ? "Salvataggio…" : "Salva ora su GitHub"}
      </Button>}
      <Button variant="outline" onClick={openArchive}>Apri Archivio e sincronizzazione</Button>
    </div>
    {remote && remote.lastSyncedCommit && !remote.autoSync &&
      <p className="muted text-xs">Per avere su GitHub una copia sempre vicina a questa, attiva «Sincronizzazione automatica dopo ogni compito» in Archivio: salva anche a metà lavoro, così sull'altro PC riparti da qui.</p>}
    <p className="muted text-xs">Il salvataggio automatico opera solo con il browser aperto e non coordina ancora gli autopilot fra dispositivi diversi.</p>
  </div>;
}
