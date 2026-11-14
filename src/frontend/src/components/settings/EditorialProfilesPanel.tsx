import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpenCheck, ChevronRight, Gavel, ListChecks, PenLine, Plus, RotateCcw, Trash2, Users } from "lucide-react";
import type { BookProject } from "../../domain/types";
import { DEFAULT_DIRECTOR_INSTRUCTIONS, defaultEditorialProfiles, EXTRA_READER_ROLES, MAX_READER_PROFILES, MAX_WRITER_PROFILES,
  MAX_WRITER_RULES, newWriterProfile, readEditorialProfileDocuments, selectedWriter,
  type EditorialProfiles, type ReaderProfile, type WriterProfile, type WriterRule } from "../../domain/editorial-profiles";
import { saveEditorialProfiles } from "../../application/editorial-profiles";
import { Button } from "../ui/button";
import { Badge, Segmented, Switch, Tabs } from "../ui/primitives";

type Tab = "writer" | "readers" | "director" | "cycle";
const STRENGTHS = [
  { value: "gentle", label: "Flessibile", hint: "Segnala solo problemi sostanziali." },
  { value: "balanced", label: "Bilanciata", hint: "Criterio prioritario, con eccezioni motivate." },
  { value: "strict", label: "Vincolo forte", hint: "Ogni violazione concreta va verificata." },
] as const;

function slugRule(label: string, taken: ReadonlySet<string>): string {
  const base = label.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "regola";
  let id = base, n = 2;
  while (taken.has(id)) id = base + "-" + n++;
  return id;
}

/** The workflow at a glance: who reads, in which order, and what decides. */
function WorkflowStrip({ draft }: { draft: EditorialProfiles }) {
  const writer = selectedWriter(draft);
  const readers = draft.readers.filter(p => p.enabled).length;
  const steps = [
    { label: "Scrittura", detail: writer ? writer.name : "Stile del libro" },
    ...(writer?.reviewEnabled ? [{ label: "Checklist dello scrittore", detail: (writer.rules?.length ?? 0) + " regole" }] : []),
    { label: "Specialisti + lettori", detail: "7 specialisti · " + readers + " lettori" },
    { label: "Direttore", detail: draft.director ? "Linee guida dell'autore" : "Standard" },
    { label: "Esito", detail: "Approvato o da rivedere · max " + (draft.maxRounds ?? 3) + " cicli" },
  ];
  return <ol aria-label="Flusso della redazione" className="flex flex-wrap items-stretch gap-1.5 text-xs">
    {steps.map((step, index) => <li key={step.label} className="flex items-center gap-1.5">
      <span className="rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900">
        <span className="block font-semibold">{step.label}</span><span className="muted block [overflow-wrap:anywhere]">{step.detail}</span>
      </span>
      {index < steps.length - 1 && <ChevronRight aria-hidden size={14} className="muted shrink-0" />}
    </li>)}
  </ol>;
}

function RuleEditor({ rules, disabled, reviewEnabled, onChange }: {
  rules: WriterRule[]; disabled: boolean; reviewEnabled: boolean; onChange: (rules: WriterRule[]) => void;
}) {
  const update = (id: string, patch: Partial<WriterRule>) => onChange(rules.map(rule => rule.id === id ? { ...rule, ...patch } : rule));
  return <fieldset className="space-y-2 rounded-xl border border-slate-300 p-3 dark:border-slate-700">
    <legend className="px-1 text-sm font-semibold">Checklist delle regole narrative ({rules.length})</legend>
    <p className="muted text-xs">La rilettura dello scrittore verifica ogni regola e lo registra nel rapporto. Una regola <b>obbligatoria</b> non soddisfatta, se il direttore respinge la correzione, ferma il capitolo per una tua decisione invece di approvarlo.</p>
    {!reviewEnabled && rules.some(r => r.mandatory) && <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">Le regole obbligatorie richiedono la rilettura dello scrittore: attivala o rendile consultive.</p>}
    <ul className="space-y-2">
      {rules.map((rule, index) => <li key={rule.id} className="rounded-lg border border-slate-300 p-2.5 dark:border-slate-700">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={rule.mandatory ? "rose" : "sky"}>{rule.mandatory ? "Obbligatoria" : "Consultiva"}</Badge>
          <code className="muted text-[11px]">{rule.id}</code>
          <Button variant="ghost" size="sm" className="ml-auto" disabled={disabled} aria-label={"Rimuovi regola " + (index + 1)}
            onClick={() => onChange(rules.filter(r => r.id !== rule.id))}><Trash2 size={15}/></Button>
        </div>
        <label className="mt-2 block text-sm">Regola {index + 1}
          <input className="field mt-1" disabled={disabled} maxLength={120} value={rule.label} onChange={e => update(rule.id, { label: e.target.value })}/></label>
        <label className="mt-2 block text-sm">Come verificarla (regola {index + 1})
          <textarea aria-label={"Come verificarla (regola " + (index + 1) + ")"} className="field mt-1" rows={2} disabled={disabled} maxLength={600}
            value={rule.description} onChange={e => update(rule.id, { description: e.target.value })}/></label>
        <Switch label="Obbligatoria" checked={rule.mandatory} disabled={disabled || !reviewEnabled}
          description="Se non rispettata, il capitolo non si congela da solo." onChange={mandatory => update(rule.id, { mandatory })}/>
      </li>)}
    </ul>
    <Button variant="outline" size="sm" disabled={disabled || rules.length >= MAX_WRITER_RULES} onClick={() => {
      const taken = new Set(rules.map(r => r.id));
      onChange([...rules, { id: slugRule("nuova-regola", taken), label: "Nuova regola", description: "", mandatory: false }]);
    }}><Plus size={15}/> Aggiungi regola</Button>
  </fieldset>;
}

export function EditorialProfilesPanel({ book, onRefresh }: { book: BookProject; onRefresh: () => Promise<void> }) {
  const saved = useMemo(() => book.editorialProfiles ?? defaultEditorialProfiles(), [book.editorialProfiles]);
  const [draft, setDraft] = useState<EditorialProfiles>(() => structuredClone(saved));
  const [tab, setTab] = useState<Tab>("writer");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0), mounted = useRef(true);
  const current = useRef(book.id); current.current = book.id;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => { generation.current++; setDraft(structuredClone(book.editorialProfiles ?? defaultEditorialProfiles())); setMessage(""); setBusy(false); }, [book.id]);
  const disabled = busy || book.status === "running";
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const writer = selectedWriter(draft);
  const editedWriter = writer ?? draft.writers[0];
  function reader(id: string, patch: Partial<ReaderProfile>) {
    setDraft(old => ({ ...old, readers: old.readers.map(p => p.id === id ? { ...p, ...patch } : p) }));
  }
  function writerPatch(id: string, patch: Partial<WriterProfile>) {
    setDraft(old => ({ ...old, writers: old.writers.map(p => {
      if (p.id !== id) return p;
      const next = { ...p, ...patch };
      // A mandatory rule needs the review that checks it.
      if (patch.reviewEnabled === false) next.rules = next.rules?.map(rule => ({ ...rule, mandatory: false }));
      return next;
    }) }));
  }
  async function save(standard = false) {
    if (!window.confirm("Salvare questi profili per il libro? Le istruzioni saranno inviate ai modelli dei rispettivi ruoli; quelle dello scrittore anche a scrittura, giudice e correzioni. Più lettori e la rilettura dello scrittore richiedono più chiamate AI e possono costare di più. I cicli già iniziati non cambiano. Autosync sarà disattivato e la coda svuotata; nessuna AI partirà ora.")) return;
    const ticket = ++generation.current, bookId = book.id;
    const isCurrent = () => mounted.current && generation.current === ticket && current.current === bookId;
    setBusy(true); setMessage("");
    try {
      await saveEditorialProfiles(bookId, book.updatedAt, standard ? undefined : structuredClone(draft), true, isCurrent);
      if (!isCurrent()) return;
      syncAfterSave.current = true;
      await onRefresh();
      if (mounted.current && current.current === bookId) {
        if (standard) setDraft(defaultEditorialProfiles());
        setMessage("Profili salvati. Nessuna AI avviata; i cicli esistenti restano invariati. Autosync disattivato.");
      }
    } catch (error) {
      if (isCurrent()) {
        await onRefresh().catch(() => undefined);
        if (isCurrent()) setMessage(error instanceof Error ? error.message : "Salvataggio dei profili non riuscito.");
      }
    } finally { if (mounted.current && current.current === bookId) setBusy(false); }
  }
  // After a successful save the stored copy (with version numbers) becomes the new draft.
  const syncAfterSave = useRef(false);
  useEffect(() => { if (syncAfterSave.current) { syncAfterSave.current = false; setDraft(structuredClone(saved)); } }, [saved]);

  const activeReaders = draft.readers.filter(p => p.enabled).length;
  return <section className="panel min-w-0 overflow-hidden" aria-label="Profili dei lettori e dello scrittore">
    <div className="space-y-3 border-b border-slate-300 p-3 sm:p-4 dark:border-slate-700">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Lettori e scrittore del libro</h2>
          <p className="muted text-sm">{book.editorialProfiles ? "Profili personalizzati attivi." : "Workflow standard attivo: cinque lettori e nessuna rilettura aggiuntiva dello scrittore."} I nuovi cicli conservano una copia esatta dei profili.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={book.editorialProfiles ? "violet" : "neutral"}>{book.editorialProfiles ? "Personalizzato" : "Standard"}</Badge>
          {dirty && <Badge tone="amber">Modifiche non salvate</Badge>}
        </div>
      </div>
      <WorkflowStrip draft={draft}/>
      <Tabs label="Agenti della redazione" value={tab} onChange={setTab} tabs={[
        { id: "writer", label: "Scrittore", icon: <PenLine size={15}/>, count: draft.writers.length },
        { id: "readers", label: "Lettori", icon: <Users size={15}/>, count: activeReaders + "/" + draft.readers.length },
        { id: "director", label: "Direttore", icon: <Gavel size={15}/> },
        { id: "cycle", label: "Ciclo", icon: <ListChecks size={15}/> },
      ]}/>
    </div>

    <div className="space-y-4 p-3 sm:p-4" role="tabpanel" id={"panel-" + tab} aria-labelledby={"tab-" + tab}>
      {tab === "writer" && <>
        <label className="block text-sm font-semibold">Scrittore da usare<select aria-label="Scrittore da usare" className="field mt-1 font-normal" disabled={disabled} value={draft.selectedWriterId ?? ""}
          onChange={e => setDraft(old => ({ ...old, selectedWriterId: e.target.value || undefined }))}>
          <option value="">Standard — stile già indicato nel libro</option>
          {draft.writers.map(p => <option key={p.id} value={p.id}>{p.name || "Scrittore senza nome"}</option>)}
        </select></label>
        {!draft.writers.length && <p className="muted rounded-xl border border-dashed border-slate-400 p-4 text-sm dark:border-slate-600">Nessun profilo: la scrittura usa lo stile del libro. Aggiungi uno scrittore per definire criteri come «mostra, non spiegare» e una checklist verificata ad ogni ciclo.</p>}
        {draft.writers.map((profile, index) => <details key={profile.id} className="group min-w-0 rounded-xl border border-slate-300 dark:border-slate-700" open={editedWriter?.id === profile.id}>
          <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-3 font-semibold [overflow-wrap:anywhere]">
            <span>{profile.name || "Scrittore senza nome"}</span>
            {draft.selectedWriterId === profile.id && <Badge tone="emerald">In uso</Badge>}
            {profile.version && <Badge>v{profile.version}</Badge>}
            {profile.reviewEnabled && <Badge tone="sky">Rilettura</Badge>}
          </summary>
          <div className="space-y-3 border-t border-slate-300 p-3 dark:border-slate-700">
            <label className="block text-sm">Nome scrittore {index + 1}<input className="field mt-1" disabled={disabled} maxLength={80} value={profile.name}
              onChange={e => writerPatch(profile.id, { name: e.target.value })}/></label>
            <label className="block text-sm">Prompt di scrittura {index + 1}<textarea aria-label={"Prompt di scrittura " + (index + 1)} className="field mt-1" rows={5} disabled={disabled} maxLength={6000} value={profile.writingPrompt}
              onChange={e => writerPatch(profile.id, { writingPrompt: e.target.value })}/></label>
            <div className="space-y-1"><p className="text-sm">Forza del criterio</p>
              <Segmented label="Forza del criterio" disabled={disabled} value={profile.strength} options={STRENGTHS}
                onChange={strength => writerPatch(profile.id, { strength })}/></div>
            <Switch label="Aggiungi la rilettura indipendente dello scrittore" checked={profile.reviewEnabled} disabled={disabled}
              description="Una chat separata che verifica la checklist su ogni segmento, prima del direttore." onChange={reviewEnabled => writerPatch(profile.id, { reviewEnabled })}/>
            <label className="block text-sm">Prompt di revisione dello scrittore {index + 1}<textarea aria-label={"Prompt di revisione dello scrittore " + (index + 1)} className="field mt-1" rows={4} disabled={disabled} maxLength={6000} value={profile.reviewPrompt}
              onChange={e => writerPatch(profile.id, { reviewPrompt: e.target.value })}/></label>
            <RuleEditor rules={profile.rules ?? []} disabled={disabled} reviewEnabled={profile.reviewEnabled}
              onChange={rules => writerPatch(profile.id, { rules })}/>
            <div className="flex flex-wrap gap-2">
              {draft.selectedWriterId !== profile.id && <Button variant="outline" disabled={disabled} onClick={() => setDraft(old => ({ ...old, selectedWriterId: profile.id }))}>Usa questo scrittore</Button>}
              <Button variant="outline" disabled={disabled} onClick={() => setDraft(old => ({ ...old, writers: old.writers.filter(p => p.id !== profile.id),
                selectedWriterId: old.selectedWriterId === profile.id ? undefined : old.selectedWriterId }))}><Trash2 size={15}/> Rimuovi questo scrittore</Button>
            </div>
          </div>
        </details>)}
        <Button variant="outline" disabled={disabled || draft.writers.length >= MAX_WRITER_PROFILES} onClick={() => {
          const created = newWriterProfile(crypto.randomUUID());
          setDraft(old => ({ ...old, selectedWriterId: created.id, writers: [...old.writers, created] }));
        }}><Plus size={16}/> Aggiungi scrittore</Button>
        <p className="muted text-xs">La rilettura è una nuova chat, non la continuazione della scrittura. Usa prosa e criteri del proprio profilo, non segreti, dossier privati o rapporti altrui. Il direttore può respingere i rilievi. Le istruzioni sono nel libro, nei suoi Markdown e negli ZIP: possono essere sensibili.</p>
      </>}

      {tab === "readers" && <>
        <p className="muted text-sm">Ogni lettore è indipendente e cieco a segreti e piani futuri. Massimo dieci; quelli attivi valutano anche le idee iniziali e i nuovi capitoli, pure con redazione leggera.</p>
        <ul className="grid gap-3 lg:grid-cols-2">
          {draft.readers.map((profile, index) => <li key={profile.id} className="min-w-0">
            <details className="min-w-0 rounded-xl border border-slate-300 dark:border-slate-700" open={index === 0}>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-3 font-semibold [overflow-wrap:anywhere]">
                <span>{profile.name || "Lettore senza nome"}</span>{!profile.enabled && " — disattivato"}
                {profile.version && <Badge>v{profile.version}</Badge>}
              </summary>
              <div className="space-y-2 border-t border-slate-300 p-3 dark:border-slate-700">
                <Switch label="Usa questo lettore" checked={profile.enabled} disabled={disabled} onChange={enabled => reader(profile.id, { enabled })}/>
                <label className="block text-sm">Nome lettore {index + 1}<input className="field mt-1" disabled={disabled} maxLength={80} value={profile.name}
                  onChange={e => reader(profile.id, { name: e.target.value })}/></label>
                <label className="block text-sm">Template lettore {index + 1}<textarea aria-label={"Template lettore " + (index + 1)} className="field mt-1" rows={5} disabled={disabled} maxLength={6000} value={profile.instructions}
                  onChange={e => reader(profile.id, { instructions: e.target.value })}/></label>
                <Button variant="outline" disabled={disabled || draft.readers.length === 1} onClick={() => setDraft(old => ({ ...old, readers: old.readers.filter(p => p.id !== profile.id) }))}><Trash2 size={15}/> Rimuovi questo lettore</Button>
              </div>
            </details>
          </li>)}
        </ul>
        <Button variant="outline" disabled={disabled || draft.readers.length >= MAX_READER_PROFILES} onClick={() => {
          const role = [...EXTRA_READER_ROLES, ...defaultEditorialProfiles().readers.map(p => p.role)].find(role => !draft.readers.some(p => p.role === role));
          if (role) setDraft(old => ({ ...old, readers: [...old.readers, { id: crypto.randomUUID(), role, name: "Nuovo lettore", enabled: true,
            instructions: "Leggi in modo indipendente e concreto. Valuta coinvolgimento, chiarezza e motivi di disinteresse senza inventare problemi." }] }));
        }}><Plus size={16}/> Aggiungi lettore</Button>
      </>}

      {tab === "director" && <>
        <p className="muted text-sm">Il direttore valuta tutti i rapporti, accetta o respinge ogni rilievo con una motivazione e decide se il capitolo va corretto. Citazioni letterali, controllo delle fonti e decisione su ogni rilievo restano obbligatori: le tue linee guida si aggiungono, non li sostituiscono.</p>
        <Switch label="Linee guida personalizzate per il direttore" checked={!!draft.director} disabled={disabled}
          onChange={on => setDraft(old => on ? { ...old, director: { instructions: DEFAULT_DIRECTOR_INSTRUCTIONS } } : (({ director: _d, ...rest }) => rest)(old))}/>
        {draft.director && <label className="block text-sm">Linee guida del direttore<textarea aria-label="Linee guida del direttore" className="field mt-1" rows={6} disabled={disabled} maxLength={6000}
          value={draft.director.instructions} onChange={e => setDraft(old => ({ ...old, director: { ...old.director!, instructions: e.target.value } }))}/></label>}
        {draft.director?.version && <p className="muted text-xs">Versione salvata: {draft.director.version}</p>}
      </>}

      {tab === "cycle" && <>
        <div className="space-y-1"><p className="text-sm font-semibold">Numero massimo di cicli di revisione</p>
          <Segmented label="Numero massimo di cicli di revisione" disabled={disabled} value={String(draft.maxRounds ?? 3) as "1" | "2" | "3"}
            options={[{ value: "1", label: "1 ciclo" }, { value: "2", label: "2 cicli" }, { value: "3", label: "3 cicli" }]}
            onChange={value => setDraft(old => value === "3" ? (({ maxRounds: _m, ...rest }) => rest)(old) : { ...old, maxRounds: Number(value) })}/>
          <p className="muted text-xs">Se dopo l'ultimo ciclo i problemi restano, il capitolo si ferma e chiede una tua decisione: nessuna approvazione silenziosa e nessun ciclo infinito.</p></div>
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {["Ogni rilievo cita il testo esatto del segmento letto.", "Il direttore decide su ogni rilievo, uno per uno.", "Una regola obbligatoria respinta ferma il capitolo.", "I cicli già iniziati non cambiano se modifichi i profili."].map(text =>
            <li key={text} className="flex items-start gap-2 rounded-lg border border-slate-300 p-2.5 dark:border-slate-700"><BookOpenCheck size={16} className="mt-0.5 shrink-0 text-emerald-600"/>{text}</li>)}
        </ul>
      </>}
    </div>

    {book.editorialCycle && <p role="status" className="mx-3 mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-sm text-amber-800 sm:mx-4 dark:text-amber-200">La redazione già iniziata mantiene i propri profili fino alla fine. Queste modifiche valgono per i nuovi cicli.</p>}
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-300 bg-slate-50 p-3 sm:px-4 dark:border-slate-700 dark:bg-slate-900/60">
      <Button disabled={disabled} onClick={() => void save()}>Salva profili del libro</Button>
      <Button variant="outline" disabled={disabled || !dirty} onClick={() => {
        if (window.confirm("Ricaricare i profili salvati del libro, scartando le modifiche non salvate di questo modulo?")) {
          setDraft(structuredClone(saved)); setMessage("");
        }
      }}><RotateCcw size={15}/> Ricarica profili salvati</Button>
      <Button variant="ghost" disabled={disabled || !book.markdownSource} onClick={() => {
        try {
          setDraft(readEditorialProfileDocuments(book.markdownSource ?? {}));
          setMessage("Template Markdown caricati soltanto come bozza. Controllali e premi Salva profili del libro per usarli nelle future chiamate AI.");
        } catch (error) { setMessage(error instanceof Error ? error.message : "Template Markdown non leggibili."); }
      }}>Carica template Markdown del libro</Button>
      <Button variant="ghost" disabled={disabled || !book.editorialProfiles} onClick={() => void save(true)}>Usa workflow standard</Button>
    </div>
    {message && <p role="status" className="px-3 pb-3 text-sm [overflow-wrap:anywhere] sm:px-4">{message}</p>}
  </section>;
}
