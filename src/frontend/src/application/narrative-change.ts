import type { Activity, BookProject } from "../domain/types";
import { emptyKnowledge, findEntity, parseKnowledge, type KnowledgeEntity } from "../domain/knowledge";
import { changeById, CHANGE_TARGET_KINDS, detectFactDrift, knownNames, pruneChangeOperations, targetLabel, type ChangeTarget, type NarrativeChangeOperation } from "../domain/narrative-change";
import { applyChangePlan, followChangeEdits, revertChange } from "../domain/narrative-change-flow";
import { memoryValue, pendingElements } from "../domain/book-edits";
import { readableSnapshot } from "../domain/edit-readable";
import { BookRevisionConflict, getBook, saveBookWithAuthorActivity } from "../infrastructure/db";

export const MAX_CHANGE_INSTRUCTION = 4000;
const REWRITABLE_REVIEW_STAGES = new Set(["review", "adjudicate", "summary"]);

/** Author-side mutation under the writer Web Lock, CAS-checked with its activity
 * in one IndexedDB transaction. No AI call is made by any of these use cases. */
async function mutate(bookId: string, expectedUpdatedAt: string, activity: Pick<Activity, "title" | "reason" | "nextStep"> & { summary?: string },
  change: (book: BookProject, now: string) => void): Promise<BookProject> {
  if (!expectedUpdatedAt) throw new BookRevisionConflict();
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request) throw new Error("Web Locks non disponibile: modifica bloccata per evitare scritture concorrenti.");
  let saved: BookProject | undefined;
  await locks.request("bookwriter:writer:" + bookId, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error("Un'altra scheda sta scrivendo questo libro: attendi o metti in pausa l'autopilot.");
    const book = await getBook(bookId);
    if (!book) throw new Error("Libro non trovato.");
    if (book.updatedAt !== expectedUpdatedAt) throw new BookRevisionConflict();
    if (book.status === "running") throw new Error("Metti prima in pausa l'autopilot.");
    const now = new Date().toISOString();
    change(book, now);
    await saveBookWithAuthorActivity(book, {
      id: crypto.randomUUID(), bookId, runId: crypto.randomUUID(), phase: book.phase, status: "succeeded",
      aiRequested: false, createdAt: now, endedAt: now, ...activity,
    }, expectedUpdatedAt);
    saved = book;
  });
  if (!saved) throw new Error("Modifica non registrata.");
  return saved;
}

function assertChangeAllowed(book: BookProject): void {
  if (book.revision) throw new Error("C'è già una revisione o una modifica in corso: completala o annullala prima di chiederne un'altra.");
  if (book.editorialReviewSceneIds?.length) throw new Error("Conferma le scene fuse nel Lettore prima di chiedere altre modifiche.");
  const stage = book.editorialCycle?.stage;
  if (book.editorialCycle && stage === "blocked")
    throw new Error("La redazione del capitolo è bloccata: risolvila nella pagina Revisioni prima di altre modifiche.");
  if (book.editorialCycle && !REWRITABLE_REVIEW_STAGES.has(stage ?? ""))
    throw new Error("La redazione sta applicando correzioni: attendi la fine di questa fase.");
  if (!book.chapters.length) throw new Error("Non c'è ancora un piano del libro.");
}

function assertTargetUsable(book: BookProject, target: ChangeTarget): void {
  if (target.kind === "scene") {
    const scene = book.chapters.flatMap(c => c.scenes).find(s => s.id === target.id);
    if (!scene?.text.trim() || scene.status === "planned") throw new Error("Si possono modificare solo scene già scritte.");
  } else if (target.kind === "chapter") {
    const chapter = book.chapters.find(c => c.id === target.id);
    if (!chapter) throw new Error("Il capitolo da modificare non esiste più.");
    if (!chapter.scenes.some(s => s.status !== "planned" && s.text.trim())) throw new Error("Il capitolo non ha ancora scene scritte: modifica il piano o lascialo scrivere.");
  } else if (target.kind === "memory") {
    if (memoryValue(book, target.id) === undefined) throw new Error("La voce della memoria non esiste più.");
  } else {
    if (!book.knowledge || book.knowledge.pending) throw new Error("Le schede del libro non sono ancora state generate.");
    const kb = book.knowledge;
    const exists = target.kind === "entity" ? kb.entities.some(e => e.id === target.id) : target.kind === "event" ? kb.events.some(e => e.id === target.id)
      : kb.timelines.some(t => t.id === target.id);
    if (!exists) throw new Error("L'elemento da modificare non esiste più.");
  }
}

/** Records the request and moves the book into a tracked revision. In automatic
 * mode the caller starts the autopilot right away: the author's prompt IS the consent. */
export async function requestNarrativeChange(bookId: string, target: ChangeTarget, instruction: string, expectedUpdatedAt: string): Promise<NarrativeChangeOperation> {
  const text = instruction.trim();
  if (text.length < 8) throw new Error("Descrivi la modifica con almeno qualche parola.");
  if (text.length > MAX_CHANGE_INSTRUCTION) throw new Error(`Richiesta troppo lunga: massimo ${MAX_CHANGE_INSTRUCTION} caratteri.`);
  let created: NarrativeChangeOperation | undefined;
  await mutate(bookId, expectedUpdatedAt, {
    title: "Modifica richiesta dall'autore", reason: "Richiesta in linguaggio naturale su un elemento del libro.",
    nextStep: "Analisi dell'impatto, riscrittura mirata e nuova revisione dei capitoli toccati.", summary: text.slice(0, 340),
  }, (book, now) => {
    assertChangeAllowed(book);
    assertTargetUsable(book, target);
    const label = targetLabel(book, target);
    created = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, target, targetLabel: label.slice(0, 200), instruction: text,
      mode: book.changeMode ?? "auto", state: "pending", before: { scenes: [] }, report: [] };
    book.changeOperations = pruneChangeOperations([...(book.changeOperations ?? []), created]);
    book.authorConstraints = book.authorConstraints ?? [];
    book.revision = { id: crypto.randomUUID(), instruction: "Modifica di «" + label + "»: " + text, beforePhase: book.phase,
      affectedSceneIds: [], cursor: 0, changeOperationId: created.id };
    book.phase = "revision";
    book.status = "paused";
    book.previousError = undefined;
  });
  return created!;
}

const clip = (text: string, max: number) => text.length > max ? text.slice(0, max) + "…" : text;
/** The author already saved edits by hand on one element: align the rest of the book with them.
 * The analysis reads what it was and what it is now, and proposes which scenes to rewrite. */
export async function requestChangeFromEdits(bookId: string, target: ChangeTarget, expectedUpdatedAt: string): Promise<NarrativeChangeOperation> {
  if (!CHANGE_TARGET_KINDS.includes(target.kind)) throw new Error("Questo elemento non può far partire una revisione del libro.");
  let created: NarrativeChangeOperation | undefined;
  await mutate(bookId, expectedUpdatedAt, {
    title: "Revisione avviata da una modifica", reason: "L'autore ha chiesto di allineare il libro a una modifica salvata a mano.",
    nextStep: "Confronto fra prima e dopo, riscrittura mirata delle scene coinvolte e nuova revisione dei capitoli.",
  }, (book, now) => {
    assertChangeAllowed(book);
    assertTargetUsable(book, target);
    const pending = pendingElements(book).find(p => p.target.kind === target.kind && p.target.id === target.id);
    const edits = (pending?.edits ?? []).filter(e => e.origin === "manual" || e.origin === "ai");
    if (!edits.length) throw new Error("Non ci sono modifiche da propagare: salva prima una modifica.");
    if (edits.some(e => e.pruned || (e.before === null && e.after === null)))
      throw new Error("Le copie di queste modifiche sono state eliminate per spazio: usa invece una richiesta scritta.");
    const label = targetLabel(book, target);
    const last = edits.at(-1)!;
    const ids = edits.slice(-100).map(e => e.id);
    let instruction: string;
    let before: NarrativeChangeOperation["before"] = { scenes: [] };
    const report: NarrativeChangeOperation["report"] = [];
    let state: NarrativeChangeOperation["state"] = "pending";
    if (target.kind === "scene") {
      const scene = book.chapters.flatMap(c => c.scenes).find(s => s.id === target.id)!;
      const textEdit = edits.find(e => e.field.includes("testo") && e.before !== null);
      if (!textEdit) throw new Error("Il testo della scena non è cambiato: non c'è nulla da propagare.");
      const previous = JSON.parse(textEdit.before!) as { text?: unknown; summary?: unknown };
      const previousText = typeof previous.text === "string" ? previous.text : "";
      before = { scenes: [{ sceneId: scene.id, chapterId: book.chapters.find(c => c.scenes.includes(scene))!.id, text: previousText,
        status: "canon", ...(typeof previous.summary === "string" && previous.summary ? { summary: previous.summary.slice(0, 6000) } : {}) }],
        memoryJson: JSON.stringify(book.memory) };
      report.push({ sceneId: scene.id, at: now, drift: detectFactDrift(previousText, scene.text, knownNames(book)) });
      instruction = "L'autore ha modificato a mano il testo della scena: confronta la versione precedente con quella attuale.";
      state = "analyzing";
    } else {
      const first = edits.find(e => e.before !== null) ?? edits[0]!;
      const was = readableSnapshot(first, "before"), now_ = readableSnapshot(last, "after");
      if (was === now_ && first.before !== null) throw new Error("Il contenuto è tornato com'era: non c'è nulla da propagare.");
      instruction = clip(`L'autore ha modificato a mano «${label}».\nPRIMA:\n${was || "(non esisteva)"}\nDOPO:\n${now_ || "(eliminato)"}`, 7800);
      before = { scenes: [], memoryJson: JSON.stringify(book.memory) };
    }
    created = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, target: { kind: target.kind, id: target.id }, targetLabel: label.slice(0, 200),
      instruction, mode: book.changeMode ?? "auto", state, before, report, fromEdits: ids };
    book.changeOperations = pruneChangeOperations([...(book.changeOperations ?? []), created]);
    book.revision = { id: crypto.randomUUID(), instruction: "Allineare il libro alla modifica manuale di «" + label + "».", beforePhase: book.phase,
      affectedSceneIds: [], cursor: 0, changeOperationId: created.id };
    book.phase = "revision";
    book.status = "paused";
    book.previousError = undefined;
    followChangeEdits(book, created, "started");
  });
  return created!;
}

export async function confirmNarrativeChange(bookId: string, operationId: string, accept: boolean, expectedUpdatedAt: string): Promise<void> {
  await mutate(bookId, expectedUpdatedAt, {
    title: accept ? "Piano della modifica confermato" : "Modifica annullata",
    reason: accept ? "L'autore ha approvato il piano di riscrittura." : "L'autore ha annullato la modifica prima delle riscritture.",
    nextStep: accept ? "Riscrittura mirata delle scene coinvolte." : "Il libro riprende dal punto precedente.",
  }, (book, now) => {
    const op = changeById(book, operationId);
    if (!op || book.revision?.changeOperationId !== op.id) throw new Error("Modifica non più in corso.");
    if (accept) {
      if (op.state !== "awaiting_confirmation") throw new Error("Il piano non attende una conferma.");
      applyChangePlan(book, op, now);
      book.previousError = undefined;
      return;
    }
    if (!["pending", "analyzing", "awaiting_confirmation"].includes(op.state)) throw new Error("Le riscritture sono già iniziate: usa il ripristino a modifica conclusa.");
    // A scene already rewritten (comparison pending/awaiting) goes back to its exact previous text.
    for (const snap of op.before.scenes) {
      const scene = book.chapters.flatMap(c => c.scenes).find(s => s.id === snap.sceneId);
      if (scene && op.target.kind === "scene" && snap.sceneId === op.target.id && op.draftText === undefined && !op.fromEdits?.length) { scene.text = snap.text; scene.summary = snap.summary; }
    }
    delete op.draftText;
    followChangeEdits(book, op, "open");
    op.state = "cancelled"; op.updatedAt = now;
    const before = book.revision!.beforePhase;
    book.revision = undefined;
    book.phase = book.editorialCycle ? "chapterReview" : ["revision", "completed"].includes(before) ? "prose" : before;
    book.previousError = undefined;
  });
}

export async function revertNarrativeChange(bookId: string, operationId: string, expectedUpdatedAt: string): Promise<void> {
  await mutate(bookId, expectedUpdatedAt, {
    title: "Modifica ripristinata", reason: "L'autore ha ripristinato la versione precedente di scene e scheda.",
    nextStep: "Nuova redazione dei capitoli toccati.",
  }, (book, now) => {
    const op = changeById(book, operationId);
    if (!op) throw new Error("Modifica non trovata.");
    revertChange(book, op, now);
    if (book.phase === "completed") book.phase = "prose";
  });
}

/** Older books: queue the sheet generation; the autopilot does it on the next run. */
export async function requestKnowledgeGeneration(bookId: string, expectedUpdatedAt: string): Promise<void> {
  await mutate(bookId, expectedUpdatedAt, {
    title: "Generazione delle schede richiesta", reason: "Costruire personaggi, luoghi, oggetti, fazioni, eventi e timeline dal libro esistente.",
    nextStep: "Al prossimo avvio l'autopilot genera la knowledge base.",
  }, book => {
    if (!book.chapters.length) throw new Error("Serve almeno il piano dei capitoli.");
    if (book.knowledge && !book.knowledge.pending && book.knowledge.entities.length) throw new Error("Le schede esistono già.");
    book.knowledge = { ...(book.knowledge ?? emptyKnowledge()), pending: true };
    if (book.status === "completed") book.status = "paused";
  });
}

export async function updateChangeMode(bookId: string, mode: "auto" | "confirm", expectedUpdatedAt: string): Promise<void> {
  await mutate(bookId, expectedUpdatedAt, {
    title: "Modalità delle modifiche aggiornata", reason: mode === "auto" ? "Le modifiche si applicano automaticamente." : "Le modifiche attendono la conferma del piano.",
    nextStep: "Vale per le prossime richieste di modifica.",
  }, book => { book.changeMode = mode; });
}

export type EntitySheetPatch = Partial<Pick<KnowledgeEntity, "name" | "summary" | "importance" | "aliases" | "attributes">>;
/** Direct edit of a sheet (no AI, no rewriting): a new version with history. */
export async function saveEntitySheet(bookId: string, entityId: string, patch: EntitySheetPatch, expectedUpdatedAt: string): Promise<void> {
  await mutate(bookId, expectedUpdatedAt, {
    title: "Scheda modificata dall'autore", reason: "Modifica diretta della scheda, senza riscrivere le scene.",
    nextStep: "Le prossime scene e revisioni useranno la nuova versione.",
  }, (book, now) => {
    const kb = book.knowledge;
    const entity = kb?.entities.find(e => e.id === entityId);
    if (!kb || !entity) throw new Error("Scheda non trovata.");
    if (patch.name && findEntity(kb, entity.type, patch.name)?.id !== entity.id && findEntity(kb, entity.type, patch.name))
      throw new Error("Esiste già una scheda con questo nome.");
    const { name, aliases, importance, summary, attributes, relationships } = entity;
    entity.history = [...(entity.history ?? []), { version: entity.version, at: now, reason: "Modifica diretta dell'autore", snapshot: { name, aliases, importance, summary, attributes, relationships } }].slice(-8);
    entity.version++;
    Object.assign(entity, patch, { origin: "author", status: "validated", updatedAt: now });
    if (patch.attributes) entity.attributes = Object.fromEntries(Object.entries(patch.attributes).filter(([, v]) => v.trim()));
    book.knowledge = parseKnowledge(kb);
  });
}
