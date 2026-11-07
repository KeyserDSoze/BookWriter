import { useState } from "react";
import type { BookProject } from "../domain/types";
import { buildNarrativeEventCandidateIndex, type NarrativeEventCandidate } from "../domain/narrative-event-candidates";
import { currentNarrativeEventDecision, MAX_EVENT_DECISIONS, type NarrativeEventDecision }
  from "../domain/narrative-event-decisions";
import { recordNarrativeEventDecision } from "../application/narrative-event-decisions";
import { buildNarrativeEventLedger } from "../domain/narrative-event-ledger";
import { buildNarrativeContinuityHints } from "../domain/narrative-continuity-hints";
import { buildNarrativeAliasRegistry, MAX_ALIAS_DECISIONS,
  type NarrativeAliasDecision } from "../domain/narrative-alias-decisions";
import { recordNarrativeAliasDecision } from "../application/narrative-alias-decisions";
import { NarrativeKnowledgeDecisionsPanel } from "./NarrativeKnowledgeDecisionsPanel";
import { Button } from "./ui/button";

function eventKey(event: NarrativeEventCandidate): string {
  return [event.chapterId, event.sceneId, event.kind, event.offset].join(":");
}

export function NarrativeEventDecisionsPanel({book,onRefresh}: {
  book: BookProject; onRefresh: () => Promise<void>;
}) {
  const [notes,setNotes] = useState<Record<string,string>>({});
  const [busy,setBusy] = useState(false);
  const [candidatePage,setCandidatePage] = useState(0);
  const [firstAlias,setFirstAlias] = useState("");
  const [secondAlias,setSecondAlias] = useState("");
  const [aliasPreview,setAliasPreview] =
    useState<{bookId:string; first:string; second:string}|null>(null);
  const [aliasNote,setAliasNote] = useState("");
  const [message,setMessage] = useState("");
  const [error,setError] = useState("");
  const index = buildNarrativeEventCandidateIndex(book);
  const history = book.narrativeEventDecisions ?? [];
  const ledger = buildNarrativeEventLedger(book);
  const aliasRegistry = buildNarrativeAliasRegistry(book);
  const aliasHistory = book.narrativeAliasDecisions ?? [];
  const currentAliasIds = new Set([...aliasRegistry.linked,...aliasRegistry.separated]
    .map(entry=>entry.decision.id));
  const actorNames = [...new Map(ledger.currentAffirmed.map(({candidate}) =>
    [candidate.actor.normalize("NFC").toLocaleLowerCase("it"),candidate.actor])).values()]
    .sort((a,b)=>a.localeCompare(b,"it"));
  const chosenFirst = actorNames.includes(firstAlias) ? firstAlias : "";
  const chosenSecond = actorNames.includes(secondAlias) ? secondAlias : "";
  const activeAliasPair = aliasPreview?.bookId === book.id
    ? {first:aliasPreview.first, second:aliasPreview.second} : undefined;
  const hints = buildNarrativeContinuityHints(book,activeAliasPair);
  const pageCount = Math.max(1, Math.ceil(index.events.length/30));
  const page = Math.min(candidatePage,pageCount-1);
  const pageStart = page*30;

  async function decide(event: NarrativeEventCandidate, verdict: NarrativeEventDecision["verdict"]) {
    if (busy) return;
    const key = eventKey(event);
    const note = (notes[key] ?? "").trim();
    if (!window.confirm(
      "Archiviare questa interpretazione dell'autore? Non modifica il canone, i segreti, la timeline " +
      "o i possessi e non prova che l'evento sia vero. L'annotazione potrà essere esportata o " +
      "sincronizzata manualmente. L'autosync sarà disabilitato e la coda GitHub svuotata.",
    )) return;
    setBusy(true); setMessage(""); setError("");
    try {
      await recordNarrativeEventDecision(book.id,book.updatedAt,event,verdict,note);
      setNotes(old=>({...old,[key]:""}));
      await onRefresh();
      setMessage("Interpretazione registrata nello storico; il canone non è cambiato. Autosync disabilitato.");
    } catch (cause) {
      setError(cause instanceof Error?cause.message:"Registrazione non riuscita.");
    } finally { setBusy(false); }
  }

  async function saveAlias(verdict: NarrativeAliasDecision["verdict"]) {
    if (busy || !chosenFirst || !chosenSecond) return;
    const note = aliasNote.trim();
    if (!window.confirm(
      "Registrare " + (verdict==="linked"?"un possibile legame":"l'esclusione del legame") +
      " fra questi due nomi? La decisione motivata resterà nello storico e nel backup. " +
      "Non aggiorna automaticamente identità canoniche, prosa o segreti. " +
      "L'autosync verrà disabilitato e la coda GitHub svuotata.",
    )) return;
    setBusy(true);setMessage("");setError("");
    try {
      await recordNarrativeAliasDecision(book.id,book.updatedAt,
        chosenFirst,chosenSecond,verdict,note);
      setAliasNote("");setAliasPreview(null);
      await onRefresh();
      setMessage("Decisione alias registrata. Il canone è invariato e l'autosync è disabilitato.");
    } catch (cause) {
      setError(cause instanceof Error?cause.message:"Decisione alias non salvata.");
    } finally {setBusy(false);}
  }

  if (!book.chapters.some(ch=>!!ch.frozenAt) && !history.length && !aliasHistory.length) return null;
  return <details className="mt-4 min-w-0 rounded-lg border border-slate-300 p-3 text-sm dark:border-slate-700">
    <summary className="cursor-pointer font-semibold">
      Indice eventi candidati ({index.events.length}) — prosa congelata e decisioni autore
    </summary>
    <p className="muted mt-2 text-xs">
      Schemi lessicali locali e fallibili: dialoghi, sogni e menzogne possono produrre falsi eventi.
      Le annotazioni dell'autore NON aggiornano automaticamente canone, segreti, timeline o oggetti.
      Scene analizzate: {index.scannedSceneCount}; non analizzate: {index.unscannedSceneCount}.
      {index.eventLimitReached && " Limite di 80 menzioni raggiunto."}
      {" "}Storico: {history.length}/{MAX_EVENT_DECISIONS}.
    </p>
    {message && <p role="status" className="mt-2 text-emerald-700 dark:text-emerald-300">{message}</p>}
    {error && <p role="alert" className="mt-2 text-red-700 dark:text-red-300">{error}</p>}
    <ul className="mt-2 space-y-2">
      {index.events.slice(pageStart,pageStart+30).map(event=>{
        const key = eventKey(event);
        const note = notes[key] ?? "";
        const current = currentNarrativeEventDecision(book,event);
        const disabled = busy || book.status === "running" ||
          (!!book.editorialCycle && book.editorialCycle.stage !== "blocked") ||
          history.length >= MAX_EVENT_DECISIONS ||
          note.trim().length < 12 || note.trim().length > 500;
        return <li key={key} className="min-w-0 rounded border border-slate-200 p-2 text-xs dark:border-slate-700">
          <p className="font-semibold">Cap. {event.chapterNumber} · scena {event.sceneNumber} · {event.kind}</p>
          <p className="mt-1 break-words">«{event.quote}»</p>
          <p className="muted mt-1 break-words">
            Testo letterale a offset {event.offset} · soggetto: {event.actor}
            {event.recipient ? " · destinatario: "+event.recipient : ""}
            {event.sceneDate ? " · data dichiarata: "+event.sceneDate : ""}
          </p>
          {current && <p className="mt-1 font-semibold text-emerald-700 dark:text-emerald-300">
            Interpretazione attuale: {current.verdict==="affirmed" ?
              "annotato come avvenuto" : "menzione respinta"} · {current.rationale}
          </p>}
          <label className="mt-2 block font-semibold">
            Motivazione dell'autore (12–500 caratteri)
            <textarea className="field mt-1 min-h-20" maxLength={500}
              aria-label={"Motivazione evento "+key} value={note}
              onChange={e=>setNotes(old=>({...old,[key]:e.target.value}))}/>
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button disabled={disabled} onClick={()=>void decide(event,"affirmed")}>Annota come avvenuto</Button>
            <Button disabled={disabled} onClick={()=>void decide(event,"dismissed")}>Respingi menzione</Button>
          </div>
        </li>;
      })}
    </ul>
    {index.events.length > 30 && <nav aria-label="Pagine menzioni narrative"
      className="mt-3 flex flex-wrap items-center gap-2">
      <Button disabled={page===0} onClick={()=>setCandidatePage(page-1)}>Pagina precedente</Button>
      <span className="muted text-xs" role="status">
        Menzioni {pageStart+1}–{Math.min(index.events.length,pageStart+30)}
        {" "}di {index.events.length} · pagina {page+1}/{pageCount}
      </span>
      <Button disabled={page===pageCount-1} onClick={()=>setCandidatePage(page+1)}>Pagina successiva</Button>
    </nav>}
    <NarrativeKnowledgeDecisionsPanel book={book} onRefresh={onRefresh}/>
    <details aria-label="Registro eventi attestati"
      className="mt-3 rounded border border-slate-300 p-2 dark:border-slate-700">
      <summary className="cursor-pointer font-semibold">
        Registro attestazioni correnti ({ledger.currentAffirmed.length})
      </summary>
      <p className="muted mt-2 text-xs">
        Solo dichiarazioni dell'autore ancora ancorate alla stessa scena canonica congelata:
        non sono fatti verificati dal software, né certificazioni storiche. Nessuna correzione
        o modifica di segreti, inventari e timeline deriva da questo elenco.
        {" "}Menzioni respinte correnti: {ledger.currentDismissed.length};
        decisioni superate/non correnti: {ledger.nonCurrentCount}.
      </p>
      {ledger.currentAffirmed.length===0 ? <p className="muted mt-2 text-xs">
        Nessuna menzione attestata attualmente valida.
      </p> : <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
        {ledger.currentAffirmed.map(({decision,candidate})=><li key={decision.id}
          className="rounded border border-slate-200 p-2 text-xs dark:border-slate-700">
          <p className="font-semibold">{candidate.actor} · cap. {candidate.chapterNumber},
            scena {candidate.sceneNumber} · {candidate.kind}</p>
          <p className="break-words">«{decision.quote}» · offset {decision.offset}</p>
          <p className="break-words">Decisione autore: {decision.rationale}</p>
        </li>)}
      </ul>}
      <p className="muted mt-3 text-xs">
        Soggetti con menzioni attestate in più capitoli: {ledger.crossChapterActors.length}.
        Il confronto usa solo il nome letterale, non riconosce alias e non dimostra contraddizioni.
      </p>
      {ledger.crossChapterActors.length>0 && <ul className="mt-2 space-y-1">
        {ledger.crossChapterActors.map(group=><li key={group.actor}
          className="break-words rounded border border-slate-200 p-2 text-xs dark:border-slate-700">
          <b>{group.actor}</b> · {group.entries.length} menzioni in
          {" "}{new Set(group.entries.map(e=>e.candidate.chapterId)).size} capitoli
          {" "}({group.entries.map(e=>"cap. "+e.candidate.chapterNumber).join(", ")})
          <p className="muted">Tracce da confrontare manualmente; nessuna incoerenza accertata.</p>
        </li>)}
      </ul>}
    </details>
    <details aria-label="Tracce di continuità da verificare"
      className="mt-3 rounded border border-slate-300 p-2 dark:border-slate-700">
      <summary className="cursor-pointer font-semibold">
        Tracce di continuità da verificare ({hints.hints.length})
      </summary>
      <fieldset className="mt-3 min-w-0 rounded border border-slate-300 p-2 dark:border-slate-700">
        <legend className="font-semibold text-xs">Confronto temporaneo tra due nomi</legend>
        <p className="muted mt-1 text-xs">
          Solo dopo la tua scelta esplicita si aggiungono piste di confronto fra due nomi
          presenti nelle attestazioni correnti. Non si dichiara che siano la stessa persona:
          l'anteprima non viene salvata, esportata o inviata all'AI.
          Puoi registrare separatamente una decisione motivata nello storico;
          nessun collegamento implicito con altri alias.
        </p>
        {actorNames.length < 2 ? <p className="muted mt-2 text-xs">
          Occorrono almeno due nomi distinti con attestazioni valide per confrontarli.
        </p> : <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-xs font-semibold">
            Primo nome
            <select className="field mt-1" aria-label="Primo nome del confronto"
              value={chosenFirst} onChange={e=>setFirstAlias(e.target.value)}>
              <option value="">Seleziona un nome</option>
              {actorNames.map(name=><option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="min-w-0 flex-1 text-xs font-semibold">
            Secondo nome
            <select className="field mt-1" aria-label="Secondo nome del confronto"
              value={chosenSecond} onChange={e=>setSecondAlias(e.target.value)}>
              <option value="">Seleziona un nome</option>
              {actorNames.map(name=><option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <Button disabled={!chosenFirst || !chosenSecond ||
            chosenFirst.normalize("NFC").toLocaleLowerCase("it") ===
            chosenSecond.normalize("NFC").toLocaleLowerCase("it")}
            onClick={()=>{
              if (!window.confirm("Confrontare temporaneamente questi due nomi come possibile " +
                "alias narrativo? Non è una conferma d'identità, non modifica il canone, " +
                "non viene salvata né inviata ai modelli AI.")) return;
              setAliasPreview({bookId:book.id,first:chosenFirst,second:chosenSecond});
            }}>Confronta temporaneamente</Button>
          <Button disabled={!activeAliasPair} onClick={()=>setAliasPreview(null)}>
            Azzera confronto
          </Button>
        </div>}
        {hints.aliasPreviewActive && activeAliasPair && <p className="mt-2 text-xs"
          role="status">
          Anteprima attiva: {activeAliasPair.first} ↔ {activeAliasPair.second}.
          I segnali originari rimangono sempre visibili. Nessuna identità confermata.
        </p>}
        {actorNames.length >= 2 && <div className="mt-3 rounded border border-slate-300 p-2 dark:border-slate-700">
          <label className="block text-xs font-semibold">
            Motivazione della decisione alias (12–500 caratteri)
            <textarea className="field mt-1 min-h-20" maxLength={500}
              aria-label="Motivazione decisione alias" value={aliasNote}
              onChange={e=>setAliasNote(e.target.value)}/>
          </label>
          <p className="muted my-2 text-xs">
            Il salvataggio memorizza le due attestazioni sorgenti, la motivazione e lo
            storico delle rettifiche. Un nuovo freeze o una rettifica di una fonte
            invalida il legame senza cancellarlo dallo storico. Non modifica il canone.
            {" "}Decisioni archiviate: {aliasHistory.length}/{MAX_ALIAS_DECISIONS}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || book.status==="running" ||
              (!!book.editorialCycle && book.editorialCycle.stage!=="blocked") ||
              aliasHistory.length>=MAX_ALIAS_DECISIONS || !chosenFirst || !chosenSecond ||
              chosenFirst.normalize("NFC").toLocaleLowerCase("it") ===
              chosenSecond.normalize("NFC").toLocaleLowerCase("it") ||
              aliasNote.trim().length<12 || aliasNote.trim().length>500}
              onClick={()=>void saveAlias("linked")}>Registra legame motivato</Button>
            <Button disabled={busy || book.status==="running" ||
              (!!book.editorialCycle && book.editorialCycle.stage!=="blocked") ||
              aliasHistory.length>=MAX_ALIAS_DECISIONS || !chosenFirst || !chosenSecond ||
              chosenFirst.normalize("NFC").toLocaleLowerCase("it") ===
              chosenSecond.normalize("NFC").toLocaleLowerCase("it") ||
              aliasNote.trim().length<12 || aliasNote.trim().length>500}
              onClick={()=>void saveAlias("separated")}>Escludi legame motivato</Button>
          </div>
        </div>}
      </fieldset>
      <details aria-label="Storico decisioni alias"
        className="mt-3 rounded border border-slate-300 p-2 dark:border-slate-700">
        <summary className="cursor-pointer font-semibold">
          Registro alias motivati ({aliasRegistry.linked.length} legami correnti)
        </summary>
        <p className="muted mt-2 text-xs">
          Non sono identità canoniche, né fatti autenticati. Revoche correnti:
          {" "}{aliasRegistry.separated.length};
          decisioni rettificate o non correnti: {aliasRegistry.nonCurrentCount}.
          Nessuna fusione automatica o deduzione transitiva tra coppie.
        </p>
        {aliasRegistry.linked.length>0 && <ul className="mt-2 space-y-1">
          {aliasRegistry.linked.map(({decision})=><li key={decision.id}
            className="break-words rounded border border-slate-200 p-2 text-xs dark:border-slate-700">
            <b>{decision.firstName} ↔ {decision.secondName}</b> · autore: {decision.rationale}
            <p className="muted">Sorgenti: {decision.firstEventDecisionId} / {
              decision.secondEventDecisionId}</p>
          </li>)}
        </ul>}
        {aliasHistory.length>0 && <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
          {[...aliasHistory].reverse().map(d=><li key={d.id}
            className="break-words rounded border border-slate-200 p-2 text-xs dark:border-slate-700">
            <b>{d.verdict==="linked"?"Legame proposto":"Legame escluso"}</b>
            {" "}· {d.firstName} / {d.secondName} · {d.decidedAt} ·
            {" "}{currentAliasIds.has(d.id)?"corrente":"storico/non corrente"}
            <p>{d.rationale}</p>
          </li>)}
        </ul>}
        {aliasHistory.length===0 && <p className="muted mt-2 text-xs">
          Nessuna decisione alias ancora archiviata.
        </p>}
        <p className="muted mt-2 text-xs">
          Gli audit importati da ZIP non autenticano l'identità dell'autore.
          Sono dichiarazioni consultive, non istruzioni ai revisori.
        </p>
      </details>
      <p className="muted mt-2 text-xs">
        Confronti locali di sole attestazioni autore attualmente valide. Le frasi sono prove
        testuali, non dimostrano una contraddizione: flashback, ritorni, omonimi o svolte
        fantastiche possono spiegare ogni sequenza. Non vengono avviate nuove review AI,
        modifiche al canone, ai segreti, alla timeline o agli oggetti.
        {" "}Attestazioni esaminate: {hints.inspectedAttestationCount};
        coppie alias motivate correnti: {hints.savedAliasPairCount}.
        {hints.omittedHintCount > 0 &&
          " Altre " + hints.omittedHintCount + " tracce omesse dal limite di 40."}
      </p>
      {hints.hints.length === 0 ? <p className="muted mt-2 text-xs">
        Nessuna sequenza lessicale selezionata: non significa che la storia sia coerente.
      </p> : <ul className="mt-2 max-h-80 space-y-2 overflow-y-auto">
        {hints.hints.map((hint,i)=><li key={hint.earlier.decision.id + ":" +
          hint.later.decision.id + ":" + hint.kind + ":" + i}
          className="rounded border border-slate-200 p-2 text-xs dark:border-slate-700">
          {hint.identityBasis !== "literal_name" && <p className="mb-1 font-semibold
            text-amber-700 dark:text-amber-300">
            {hint.identityBasis==="alias_preview"?"Solo anteprima alias:":"Alias motivato in registro:"}
            {" "}«{hint.earlier.candidate.actor}» e
            «{hint.later.candidate.actor}» ipotizzati come stessa identità dall'autore,
            non certificati dal software.
            {hint.aliasRationale && " Motivazione del legame: "+hint.aliasRationale}
          </p>}
          <p className="font-semibold">
            {hint.kind === "repeated_death" ? "Morte menzionata più volte" :
              hint.kind === "post_death_activity" ? "Azione dopo menzione di morte" :
              "Date dichiarate in ordine inverso"} · {hint.actor}
          </p>
          <p className="mt-1 break-words">
            <b>Prima, cap. {hint.earlier.candidate.chapterNumber} · scena {
              hint.earlier.candidate.sceneNumber}:</b> «{hint.earlier.decision.quote}»
            {" "}· offset {hint.earlier.decision.offset}
            {hint.earlier.candidate.sceneDate &&
              " · data dichiarata: " + hint.earlier.candidate.sceneDate}
          </p>
          <p className="mt-1 break-words">
            <b>Poi, cap. {hint.later.candidate.chapterNumber} · scena {
              hint.later.candidate.sceneNumber}:</b> «{hint.later.decision.quote}»
            {" "}· offset {hint.later.decision.offset}
            {hint.later.candidate.sceneDate &&
              " · data dichiarata: " + hint.later.candidate.sceneDate}
          </p>
          <p className="muted mt-1 break-words">{hint.explanation}</p>
          <p className="mt-1 break-words">Motivi dell'autore:
            {" "}{hint.earlier.decision.rationale} / {hint.later.decision.rationale}
          </p>
        </li>)}
      </ul>}
      <p className="muted mt-2 text-xs">
        Il confronto usa nomi letterali e ordine dei capitoli, non verifica l'ordine degli
        eventi raccontati. Le date si confrontano solo se espresse come YYYY-MM-DD,
        e sono metadati correnti della scena, non date autenticate all'annotazione.
        La risurrezione esplicita attestata interrompe il solo confronto lessicale con
        una morte precedente; non prova una spiegazione narrativa.
      </p>
    </details>
    {history.length > 0 && <details className="mt-3 rounded border border-slate-300 p-2 dark:border-slate-700">
      <summary className="cursor-pointer font-semibold">
        Storico decisioni autore ({history.length}) — incluse quelle superate
      </summary>
      <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
        {[...history].reverse().map(d=>{
          const candidate = index.events.find(e=>e.chapterId===d.chapterId &&
            e.sceneId===d.sceneId && e.kind===d.kind && e.offset===d.offset &&
            e.quote===d.quote);
          const current = candidate && currentNarrativeEventDecision(book,candidate)?.id===d.id;
          return <li key={d.id} className="rounded border border-slate-200 p-2 text-xs dark:border-slate-700">
            <p className="font-semibold">{d.verdict==="affirmed"?"Annotato avvenuto":"Respinto"}
              {" "}· {d.decidedAt} · {current?"corrente":"storico/non corrente"}</p>
            <p className="break-words">«{d.quote}» · {d.chapterId}/{d.sceneId}, offset {d.offset}</p>
            <p className="break-words">{d.rationale}</p>
          </li>;
        })}
      </ul>
      <p className="muted mt-2 text-xs">
        I record importati non autenticano chi li abbia scritti. Una scena modificata, riaperta o non
        più indicizzata rende l'annotazione non corrente. Nessun giudizio viene cancellato automaticamente.
      </p>
    </details>}
  </details>;
}
