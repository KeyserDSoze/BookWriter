import { useEffect, useMemo, useRef, useState } from "react";
import { GitCompareArrows, Save, Sparkles, XCircle } from "lucide-react";
import type { AppSettings } from "../domain/types";
import { routeFor } from "../domain/types";
import { diffSceneText } from "../domain/scene-diff";
import type { ConflictUnit } from "../domain/conflicts";
import type { AcceptedSceneDraft, SceneMergeDraft } from "../domain/scene-merge";
import type { ConflictReview } from "../infrastructure/conflict-recovery";
import {
  generateSceneMergeDraft, listSceneMergeDrafts,
  rejectSceneMergeDraft, saveManualSceneMergeDraft,
} from "../application/scene-merge";
import { Button } from "./ui/button";

interface Props {
  review: ConflictReview;
  unit: Extract<ConflictUnit, { kind: "scene" }>;
  settings: AppSettings;
  selected?: AcceptedSceneDraft;
  onChoose: (choice: AcceptedSceneDraft) => void;
  onClear: () => void;
}
export function SceneMergeWorkspace({ review, unit, settings, selected, onChoose, onClear }: Props) {
  const local = review.local.chapters.find(x => x.id === unit.chapterId)
    ?.scenes.find(x => x.id === unit.sceneId);
  const remote = review.remote.chapters.find(x => x.id === unit.chapterId)
    ?.scenes.find(x => x.id === unit.sceneId);
  const [drafts, setDrafts] = useState<SceneMergeDraft[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [text, setText] = useState(local?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const activeRequest = useRef<AbortController | null>(null);
  const route = routeFor("merge", settings, review.local);
  const endpoint = settings.endpoints.find(x => x.id === route.endpointId);
  const canGenerate = !!route.modelId && !!endpoint?.secret;
  const diff = useMemo(
    () => local && remote ? diffSceneText(local.text, remote.text) : null,
    [local?.text, remote?.text],
  );

  useEffect(() => {
    let mounted = true;
    void listSceneMergeDrafts(review, unit.chapterId, unit.sceneId).then(rows => {
      if (mounted) setDrafts(rows);
    }).catch(() => { if (mounted) setError("Impossibile caricare le bozze salvate."); });
    return () => { mounted = false; activeRequest.current?.abort(); };
  }, [review, unit.chapterId, unit.sceneId]);

  async function act(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await action(); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "Operazione sulla bozza non riuscita.");
    } finally { setBusy(false); }
  }
  function selectDraft(draft: SceneMergeDraft) {
    setSelectedId(draft.id);
    setText(draft.acceptedText ?? draft.proposedText);
    onClear(); // Restores conservative local choice until explicitly approved.
  }
  async function generate() {
    if (!local || !remote || !canGenerate) return;
    if (!window.confirm(
      "Inviare ENTRAMBE le versioni della scena, il canone e i segreti narrativi all'endpoint " +
      (endpoint?.name ?? route.endpointId) + " con modello " + route.modelId +
      "? La chiamata può consumare crediti AI. Il risultato resterà una bozza e richiederà approvazione.",
    )) return;
    await act(async () => {
      const controller = new AbortController();
      activeRequest.current = controller;
      try {
        const draft = await generateSceneMergeDraft(
          review, unit.chapterId, unit.sceneId, instruction, controller,
        );
        setDrafts(previous => [draft, ...previous]);
        selectDraft(draft);
        setMessage("Proposta AI salvata in IndexedDB, non ancora applicata al libro.");
      } finally {
        activeRequest.current = null;
      }
    });
  }
  async function saveManual() {
    if (!local || !remote) return;
    await act(async () => {
      const draft = await saveManualSceneMergeDraft(review, unit.chapterId, unit.sceneId, text);
      setDrafts(previous => [draft, ...previous]);
      selectDraft(draft);
      setMessage("Bozza manuale salvata. Per applicarla, scegli esplicitamente Usa questa proposta.");
    });
  }
  async function reject() {
    if (!selectedId) return;
    await act(async () => {
      await rejectSceneMergeDraft(selectedId);
      setDrafts(current => current.map(d => d.id === selectedId ? { ...d, status: "rejected" } : d));
      onClear();
      setSelectedId("");
      setMessage("Bozza rifiutata. La scena del libro non è stata modificata.");
    });
  }
  const selectedDraft = drafts.find(d => d.id === selectedId);
  const isProposed = selectedDraft?.status === "proposed";

  return <div className="mt-3 space-y-3 border-t border-slate-300 pt-3 dark:border-slate-700">
    <h4 className="flex items-center gap-2 text-sm font-semibold"><GitCompareArrows size={17}/> Differenze nel testo della scena</h4>
    {!local || !remote ? <p className="muted text-xs">
      La scena esiste in una sola versione. La fusione manuale/AI richiede due scene da confrontare.
    </p> : <>
      {diff && <details>
        <summary className="cursor-pointer text-sm font-semibold">
          Diff {diff.mode === "words" ? "parola per parola" : diff.mode === "paragraphs" ? "per paragrafi" : "scene complete"}
        </summary>
        {diff.fallback && <p className="muted my-2 text-xs">
          Testi lunghi: confronto semplificato per evitare rallentamenti sui dispositivi mobili.
        </p>}
        <div aria-label="Differenze scena" className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-slate-300 p-3 text-sm leading-7 whitespace-pre-wrap break-words dark:border-slate-700">
          {diff.pieces.map((part, index) => <span key={index}
            className={part.kind === "local" ? "bg-red-200 text-red-950 dark:bg-red-900/70 dark:text-red-100" :
              part.kind === "remote" ? "bg-emerald-200 text-emerald-950 dark:bg-emerald-900/70 dark:text-emerald-100" : ""}>
            {part.text}
          </span>)}
        </div>
        <p className="muted mt-2 text-xs">Rosso: solo nella versione locale · Verde: solo nella versione GitHub. Il diff non modifica il manoscritto.</p>
      </details>}
      <h4 className="flex items-center gap-2 text-sm font-semibold"><Sparkles size={17}/> Laboratorio di fusione (bozze non canoniche)</h4>
      <p className="muted text-xs">
        Puoi combinare i testi manualmente senza crediti, oppure chiedere una proposta AI.
        Nessuna bozza sarà usata nel libro finché non premi Usa questa proposta e Applica scelte con doppio backup.
      </p>
      <label className="block text-sm font-semibold">
        Indicazioni opzionali per l'AI
        <textarea className="field mt-1 min-h-20" maxLength={3000} value={instruction}
          disabled={busy} onChange={e => setInstruction(e.target.value)}
          placeholder="Mantieni questo indizio, conserva la tensione, evita di rivelare il segreto..." />
      </label>
      <div className="text-xs">
        <p><b>Modello fusione:</b> {endpoint?.name ?? "Endpoint assente"} / {route.modelId || "Non configurato"}</p>
        {!canGenerate && <p className="text-amber-700 dark:text-amber-300">
          Configura un modello e la relativa API key in Impostazioni → Fusione di scene (override per libro disponibile).
        </p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy || !canGenerate}
          onClick={() => void generate()}><Sparkles size={16}/> Genera proposta AI</Button>
        {busy && activeRequest.current && <Button variant="outline"
          onClick={() => activeRequest.current?.abort()}>Interrompi chiamata</Button>}
      </div>
      <label className="block text-sm font-semibold">
        Bozza modificabile (non canonica)
        <textarea className="field mt-1 min-h-52 w-full" value={text} disabled={busy}
          onChange={e => { setText(e.target.value); if (selected) onClear(); }}
          aria-label={"Testo bozza fusione: " + unit.id}
          placeholder="Combina manualmente le due versioni oppure genera una proposta AI." />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy || !text.trim()}
          onClick={() => void saveManual()}><Save size={16}/> Salva nuova bozza manuale</Button>
        {isProposed && <Button disabled={busy || !text.trim()}
          onClick={() => {
            onChoose({ draftId: selectedId, text });
            setMessage("Proposta selezionata. Rimane una bozza finché non confermi il recupero con doppio backup.");
          }}>Usa questa proposta per la scena</Button>}
        {isProposed && <Button variant="destructive" disabled={busy}
          onClick={() => void reject()}><XCircle size={16}/> Rifiuta bozza</Button>}
      </div>
      {selected?.draftId === selectedId && selected && <p className="text-sm text-emerald-700 dark:text-emerald-300">
        Questa bozza è stata selezionata per il recupero; puoi ancora annullarla o cambiare la scelta locale/GitHub.
      </p>}
      {drafts.length > 0 && <div className="space-y-2">
        <label className="block text-sm font-semibold">
          Storico bozze locali ({drafts.length})
          <select className="field mt-1" value={selectedId}
            onChange={e => {
              const found = drafts.find(d => d.id === e.target.value);
              if (found) selectDraft(found); else { setSelectedId(""); onClear(); }
            }} aria-label={"Storico bozze: " + unit.id}>
            <option value="">Seleziona una bozza salvata</option>
            {drafts.map(d => <option key={d.id} value={d.id}>
              {new Date(d.createdAt).toLocaleString("it-IT")} · {d.source === "ai" ? "AI" : "Manuale"} · {d.status}
            </option>)}
          </select>
        </label>
        {selectedDraft && <p className="muted text-xs">
          {selectedDraft.source === "ai" ? "Modello: " + selectedDraft.modelId + " · Endpoint: " + selectedDraft.endpointId :
            "Bozza scritta dall'autore"}
          {selectedDraft.inputTokens !== undefined && " · Input " + selectedDraft.inputTokens + " token"}
          {selectedDraft.outputTokens !== undefined && " · Output " + selectedDraft.outputTokens + " token"}
        </p>}
      </div>}
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      {message && <p role="status" className="text-sm">{message}</p>}
    </>}
  </div>;
}
