import type { BookProject, Chapter, Scene } from "./types";
import { EDITORIAL_ROLES, ROLE_LABELS, acceptedRepairs, chapterSegments } from "./editorial-board";

export type PipelineStage = "ideation" | "planning" | "writing" | "editing" | "done";
export const PIPELINE_STAGES: ReadonlyArray<{ id: PipelineStage; label: string; description: string }> = [
  { id: "ideation", label: "Ideazione", description: "Brainstorming, validazione, cinque lettori e critica avversaria." },
  { id: "planning", label: "Piano", description: "Capitoli e scene da scrivere." },
  { id: "writing", label: "Scrittura", description: "Una scena alla volta: stesura, revisione e memoria narrativa." },
  { id: "editing", label: "Redazione", description: "Per ogni capitolo: 12 revisori indipendenti, direttore, correzioni e congelamento." },
  { id: "done", label: "Completato", description: "Tutti i capitoli scritti e congelati." },
];

export interface AutopilotStepView {
  stage: PipelineStage;
  /** Plain-language description of the next (or current) step. */
  headline: string;
  detail?: string;
  chapterNumber?: number;
  sceneNumber?: number;
  /** The next AI task would receive pending author next-step notes. */
  acceptsAuthorNotes: boolean;
  /** The autopilot cannot continue without an author action. */
  blocked?: string;
  revision: boolean;
}

export interface BookProgress {
  chapters: number;
  frozenChapters: number;
  scenes: number;
  canonScenes: number;
  writtenScenes: number;
  words: number;
}

function locate(book: BookProject, sceneId: string | undefined):
  { chapter: Chapter; scene: Scene } | undefined {
  for (const chapter of book.chapters) {
    const scene = chapter.scenes.find(s => s.id === sceneId);
    if (scene) return { chapter, scene };
  }
  return undefined;
}
function sceneLabel(chapter: Chapter, scene: Scene): string {
  return `scena ${scene.number} del capitolo ${chapter.number} «${scene.title}»`;
}
/** Same order as the runner: the first complete, unfrozen chapter after frozen predecessors. */
export function chapterReadyForEditing(book: BookProject): Chapter | undefined {
  if (book.editorialCycle) return undefined;
  return [...book.chapters]
    .filter(ch => !ch.frozenAt && ch.scenes.length > 0 && ch.scenes.every(s => s.status === "canon"))
    .sort((a, b) => a.number - b.number)
    .find(ch => book.chapters.every(prev => prev.number >= ch.number || !!prev.frozenAt));
}

export function pipelineStage(book: BookProject): PipelineStage {
  switch (book.phase) {
    case "brainstorm": case "validate": case "audience": case "adversarial": return "ideation";
    case "outline": return "planning";
    case "chapterReview": return "editing";
    case "completed": return "done";
    case "prose": return chapterReadyForEditing(book) ? "editing" : "writing";
    case "revision":
      return book.chapters.some(ch => ch.scenes.some(s => s.text.trim())) ? "writing" :
        book.chapters.length ? "planning" : "ideation";
    default: return "writing";
  }
}

export function bookProgress(book: BookProject): BookProgress {
  const progress: BookProgress = { chapters: book.chapters.length, frozenChapters: 0,
    scenes: 0, canonScenes: 0, writtenScenes: 0, words: 0 };
  for (const chapter of book.chapters) {
    if (chapter.frozenAt) progress.frozenChapters++;
    for (const scene of chapter.scenes) {
      progress.scenes++;
      if (scene.status === "canon") progress.canonScenes++;
      if (scene.text.trim()) {
        progress.writtenScenes++;
        progress.words += scene.text.match(/\S+/g)?.length ?? 0;
      }
    }
  }
  return progress;
}

/** Read-only mirror of the runner's next step. Never throws and never calls AI. */
export function describeNextAutopilotStep(book: BookProject): AutopilotStepView {
  const stage = pipelineStage(book);
  const view = (headline: string, extra: Partial<AutopilotStepView> = {}): AutopilotStepView =>
    ({ stage, headline, acceptsAuthorNotes: false, revision: book.phase === "revision", ...extra });
  if (book.status === "completed" || book.phase === "completed")
    return view("Libro completato: tutti i capitoli sono scritti e congelati.", {
      detail: "Puoi esportarlo dall'Archivio oppure chiedere una revisione con un intervento." });
  if (book.editorialReviewSceneIds?.length)
    return view("Conferma le scene fuse nella pagina Libro.", {
      blocked: "Alcune scene fuse attendono la tua rilettura: l'autopilot riparte solo dopo la conferma." });
  const synopsisCount = book.startMode === "synopsis" ? book.authorChapterSynopses?.length ?? 0 : 0;
  switch (book.phase) {
    case "brainstorm":
      return view("Brainstorming: idee a lungo, medio e breve termine.", { acceptsAuthorNotes: true,
        detail: synopsisCount ? `Arricchisce la tua sinossi di ${synopsisCount} capitoli senza cambiarne gli eventi.`
          : "Alternative, conflitti, indizi e payoff prima di fissare la trama." });
    case "validate":
      return view("Validazione critica delle idee.", { acceptsAuthorNotes: true,
        detail: "Coerenza, causalità, originalità e fedeltà alle tue indicazioni." });
    case "audience":
      return view(`Panel dei lettori: profilo ${Math.min(book.audienceReviews.length + 1, 5)} di 5.`, {
        acceptsAuthorNotes: true, detail: "Cinque lettori simulati valutano le idee in modo indipendente." });
    case "adversarial":
      return view("Critica avversaria della trama.", { acceptsAuthorNotes: true,
        detail: "Ricerca di buchi di trama, cliché, spoiler e motivazioni deboli." });
    case "outline":
      return view(synopsisCount ? `Piano delle scene per i ${synopsisCount} capitoli della tua sinossi.`
        : book.targetChapterCount ? `Piano di ${book.targetChapterCount} capitoli e delle loro scene.`
          : "Piano dei capitoli e delle scene.", { acceptsAuthorNotes: true,
        detail: book.pauseAfterOutline ? "Dopo il piano l'autopilot si ferma per la tua approvazione." : undefined });
    case "prose": {
      const ready = chapterReadyForEditing(book);
      if (ready) return view(`Redazione del capitolo ${ready.number} «${ready.title}»: 12 revisori indipendenti e direttore editoriale.`, {
        chapterNumber: ready.number,
        detail: "Il capitolo viene congelato solo dopo il giudizio del direttore e le eventuali correzioni." });
      for (const chapter of book.chapters) {
        const scene = chapter.scenes.find(s => s.status !== "canon");
        if (scene) return view(`Scrittura della ${sceneLabel(chapter, scene)}.`, {
          acceptsAuthorNotes: true, chapterNumber: chapter.number, sceneNumber: scene.number,
          detail: scene.objective ? "Obiettivo: " + scene.objective : undefined });
      }
      return view("Chiusura del libro: nessuna scena da scrivere.");
    }
    case "review": {
      const target = locate(book, book.currentSceneId);
      return target ? view(`Revisione finale della ${sceneLabel(target.chapter, target.scene)}.`, {
        acceptsAuthorNotes: true, chapterNumber: target.chapter.number, sceneNumber: target.scene.number,
        detail: "Coerenza con canone, voci, cronologia e segreti; la scena diventa canonica." })
        : view("Revisione della scena corrente.", { blocked: "La scena da rivedere non esiste più." });
    }
    case "consolidate": {
      const target = locate(book, book.currentSceneId);
      return view(target ? `Aggiornamento della memoria narrativa dopo la ${sceneLabel(target.chapter, target.scene)}.`
        : "Aggiornamento della memoria narrativa.", { acceptsAuthorNotes: true,
        chapterNumber: target?.chapter.number, sceneNumber: target?.scene.number,
        detail: "Personaggi, luoghi, oggetti, segreti e cronologia." });
    }
    case "chapterReview": {
      const cycle = book.editorialCycle;
      const chapter = cycle && book.chapters.find(ch => ch.id === cycle.chapterId);
      if (!cycle || !chapter) return view("Redazione del capitolo.", {
        blocked: "Sessione di redazione mancante o non valida: controlla il pannello Redazione." });
      const where = `capitolo ${chapter.number} «${chapter.title}»`;
      switch (cycle.stage) {
        case "review": {
          try {
            const segments = chapterSegments(chapter).length;
            const done = cycle.reports.length;
            const role = EDITORIAL_ROLES[Math.floor(done / segments)];
            if (role) return view(`Redazione del ${where}: revisore ${done + 1} di ${segments * EDITORIAL_ROLES.length} — ${ROLE_LABELS[role]}.`, {
              chapterNumber: chapter.number, detail: `Tornata ${cycle.round}/3. Ogni revisore è una chiamata AI indipendente che non vede gli altri pareri.` });
          } catch { /* the board panel explains invalid checkpoints */ }
          return view(`Redazione del ${where}.`, { chapterNumber: chapter.number });
        }
        case "adjudicate":
          return view(`Il direttore editoriale decide i rilievi del ${where}.`, { chapterNumber: chapter.number,
            detail: "Accetta o respinge ogni rilievo con motivazione." });
        case "repair": {
          let total = 0;
          try { total = new Set(acceptedRepairs(cycle).map(fix => fix.sceneId)).size; } catch { /* invalid judgment */ }
          return view(`Correzione approvata nel ${where}` + (total ? ` (scena ${Math.min(cycle.repairCursor + 1, total)} di ${total}).` : "."), {
            acceptsAuthorNotes: true, chapterNumber: chapter.number });
        }
        case "reconcile":
          return view(`Aggiornamento della memoria dopo le correzioni del ${where}.`, {
            acceptsAuthorNotes: true, chapterNumber: chapter.number });
        case "summary":
          return view(`Sinossi e congelamento del ${where}.`, { chapterNumber: chapter.number });
        case "blocked":
          return view(`Redazione del ${where} bloccata.`, { chapterNumber: chapter.number,
            blocked: cycle.blockedReason ?? "Servono le tue indicazioni nel pannello Redazione." });
      }
      return view(`Redazione del ${where}.`, { chapterNumber: chapter.number });
    }
    case "revision": {
      const rev = book.revision;
      if (!rev) return view("Revisione richiesta dall'autore.", { blocked: "Revisione senza istruzione: registra di nuovo l'intervento." });
      if (rev.impactAnalysis === undefined)
        return view("Analisi d'impatto della tua revisione.", { acceptsAuthorNotes: true,
          detail: "Individua le scene coinvolte: «" + rev.instruction.slice(0, 160) + (rev.instruction.length > 160 ? "…" : "") + "»" });
      const sceneId = rev.affectedSceneIds[rev.cursor];
      const target = locate(book, sceneId);
      if (target) return view(`Riscrittura retroattiva ${rev.cursor + 1} di ${rev.affectedSceneIds.length}: ${sceneLabel(target.chapter, target.scene)}.`, {
        acceptsAuthorNotes: true, chapterNumber: target.chapter.number, sceneNumber: target.scene.number });
      if (sceneId) return view("Riscrittura retroattiva.", {
        blocked: "Una scena della revisione non esiste più: registra di nuovo l'intervento." });
      return rev.affectedSceneIds.length
        ? view("Aggiornamento della memoria narrativa dopo la revisione.", { acceptsAuthorNotes: true })
        : view("Chiusura della revisione: nessuna scena da riscrivere.");
    }
  }
  return view("Prossimo passo dell'autopilot.");
}
