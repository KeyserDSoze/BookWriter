import { useCallback, useEffect, useState } from "react";
import type { BookProject, SyncOutboxItem } from "../domain/types";
import { githubPublicationBlocker } from "../domain/github-publication";
import { getOutbox } from "../infrastructure/outbox";
import { saveToGitHubNow } from "./auto-sync";

/** What the author needs to know about the GitHub copy of the book being worked on, and the «save now» action.
 * Read-only apart from `saveNow`, which goes through the same queue as the automatic saves. */
export function useGitHubSave(book: BookProject | undefined, onSaved: () => void | Promise<void>) {
  const [queued, setQueued] = useState<SyncOutboxItem | undefined>();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const id = book?.id, updatedAt = book?.updatedAt;
  useEffect(() => {
    if (!id) { setQueued(undefined); return; }
    let mounted = true;
    const update = () => { void getOutbox(id).then(item => { if (mounted) setQueued(item); }).catch(() => undefined); };
    update();
    const timer = window.setInterval(update, 5000);
    return () => { mounted = false; clearInterval(timer); };
  }, [id, updatedAt]);
  useEffect(() => setMessage(""), [id]);

  const remote = book?.remote;
  const active = !!remote?.autoSync && !!remote.lastSyncedCommit;
  const unsaved = active && (remote!.lastSyncedLocalUpdatedAt !== updatedAt || !!queued);
  const blocker = book ? githubPublicationBlocker(book) : undefined;
  const label = !active ? "" :
    queued?.state === "blocked" ? "GitHub: salvataggio bloccato (dettagli in Archivio)" :
    queued?.state === "syncing" ? "GitHub: salvataggio in corso…" :
    unsaved ? "GitHub: modifiche non ancora salvate" :
    "GitHub: salvato" + (remote!.lastSyncAt ? " alle " + new Date(remote!.lastSyncAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "");

  const saveNow = useCallback(async () => {
    if (!id) return;
    setSaving(true); setMessage("");
    try {
      const outcome = await saveToGitHubNow(id);
      const left = await getOutbox(id);
      setQueued(left);
      setMessage(outcome === "already_saved" ? "GitHub ha già l'ultima versione." :
        outcome === "blocked" ? blocker ?? "Salvataggio bloccato." :
        outcome !== "attempted" ? "Per salvare servono il collegamento a GitHub, il primo salvataggio e la sincronizzazione automatica accesa (Archivio)." :
        left?.lastError ? "Salvataggio non riuscito: " + left.lastError :
        left ? "Il libro è cambiato durante il salvataggio: la versione più recente parte tra pochi secondi." :
        "Libro salvato su GitHub.");
      await onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Salvataggio non riuscito.");
    } finally { setSaving(false); }
  }, [id, blocker, onSaved]);

  return { active, unsaved, queued, saving, message, label, blocker, saveNow };
}
