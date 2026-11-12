import type { Activity, AuthorIntervention, AuthorInterventionScope } from "../domain/types";
import {
  INTERVENTION_SCOPE_LABELS, MAX_AUTHOR_INTERVENTIONS, MAX_INTERVENTION_CHARS,
} from "../domain/author-interventions";
import { describeNextAutopilotStep } from "../domain/autopilot-step";
import { BookRevisionConflict, getBook, saveBookWithAuthorActivity } from "../infrastructure/db";

export interface AuthorInterventionInput {
  instruction: string;
  scope: AuthorInterventionScope;
  /** Step running or next when the author intervened (display only). */
  stepLabel?: string;
  /** Task the author interrupted or referenced. */
  activityId?: string;
}
export type InterventionEffect = "note" | "constraint" | "revision" | "replan";
export interface RecordedIntervention { intervention: AuthorIntervention; effect: InterventionEffect }

const REWRITABLE_REVIEW_STAGES = new Set(["review", "adjudicate", "summary"]);

function summary(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 340 ? clean.slice(0, 337) + "…" : clean;
}

/**
 * Record an author prompt for the autopilot. It is persisted in the book's
 * append-only intervention log AND as an Activity, in one CAS transaction
 * under the same writer Web Lock used by the runner: a stale tab or an
 * active autopilot can never be overwritten, and no AI call is made here.
 */
export async function recordAuthorIntervention(
  bookId: string, input: AuthorInterventionInput, expectedUpdatedAt: string,
): Promise<RecordedIntervention> {
  const instruction = input.instruction.trim();
  if (!instruction) throw new Error("Scrivi la modifica che desideri.");
  if (instruction.length > MAX_INTERVENTION_CHARS)
    throw new Error(`Intervento troppo lungo: massimo ${MAX_INTERVENTION_CHARS} caratteri.`);
  if (!INTERVENTION_SCOPE_LABELS[input.scope]) throw new Error("Tipo di intervento non valido.");
  if (!expectedUpdatedAt) throw new BookRevisionConflict();

  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request)
    throw new Error("Web Locks non disponibile: intervento bloccato per evitare scritture concorrenti.");
  let recorded: RecordedIntervention | undefined;
  await locks.request("bookwriter:writer:" + bookId, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error("Un'altra scheda sta scrivendo questo libro: attendi prima di intervenire.");
    const book = await getBook(bookId);
    if (!book) throw new Error("Libro non trovato.");
    if (book.updatedAt !== expectedUpdatedAt) throw new BookRevisionConflict();
    if (book.status === "running") throw new Error("Metti prima in pausa l'autopilot.");
    if ((book.authorInterventions?.length ?? 0) >= MAX_AUTHOR_INTERVENTIONS)
      throw new Error("Registro degli interventi pieno: crea un backup ZIP e un fork del libro per continuare.");
    const completed = book.status === "completed" || book.phase === "completed";
    if (completed && input.scope !== "rewrite")
      throw new Error("Il libro è completato: per cambiarlo scegli «Rivedi anche il già scritto».");
    const written = book.chapters.some(ch => ch.scenes.some(scene => scene.text.trim()));
    if (input.scope === "rewrite") {
      if (book.editorialReviewSceneIds?.length)
        throw new Error("Conferma le scene fuse nel Lettore prima di richiedere altre revisioni AI.");
      const stage = book.editorialCycle?.stage;
      if (book.editorialCycle && stage === "blocked")
        throw new Error("La redazione del capitolo è bloccata: indica come risolverla nel pannello Redazione con «Riparti con i nuovi vincoli».");
      if (book.editorialCycle && !REWRITABLE_REVIEW_STAGES.has(stage ?? ""))
        throw new Error("La redazione del capitolo sta applicando correzioni: attendi la fine di questa fase oppure registra un intervento «Da ora in poi».");
      if (!book.chapters.length)
        throw new Error("Non c'è ancora un piano o un testo da riscrivere: scegli «Solo per il prossimo passo» o «Da ora in poi».");
    }

    const now = new Date().toISOString();
    const intervention: AuthorIntervention = {
      id: crypto.randomUUID(), createdAt: now, instruction, scope: input.scope,
      phase: book.phase,
      stepLabel: (input.stepLabel?.trim() || describeNextAutopilotStep(book).headline).slice(0, 300),
      ...(input.activityId ? { activityId: input.activityId } : {}),
    };
    let effect: InterventionEffect = "note";
    let nextStep = "Sarà inviata al prossimo task di scrittura, poi archiviata come applicata.";
    if (input.scope !== "next_step") {
      book.authorConstraints = [...(book.authorConstraints ?? []), instruction];
      effect = "constraint";
      nextStep = "Vincolo inderogabile per tutti i task successivi; il testo già scritto resta invariato.";
    }
    if (input.scope === "rewrite" && !written) {
      // Only the plan exists: regenerate it, nothing written can be lost.
      book.phase = "outline";
      book.currentSceneId = undefined;
      book.previousError = undefined;
      if (book.status !== "idle") book.status = "paused";
      effect = "replan";
      nextStep = "Alla ripresa l'autopilot rifà il piano dei capitoli con questo vincolo.";
    } else if (input.scope === "rewrite") {
      // A pending revision is merged, never silently replaced.
      const previous = book.phase === "revision" ? book.revision : undefined;
      book.revision = {
        id: crypto.randomUUID(),
        instruction: previous ? previous.instruction + "\n" + instruction : instruction,
        beforePhase: previous?.beforePhase ?? book.phase,
        affectedSceneIds: [], cursor: 0,
      };
      book.phase = "revision";
      book.status = "paused";
      book.previousError = undefined;
      effect = "revision";
      nextStep = "Alla ripresa: analisi d'impatto, riscrittura delle scene coinvolte e nuova redazione dei capitoli toccati.";
    }
    book.authorInterventions = [...(book.authorInterventions ?? []), intervention];
    const activity: Activity = {
      id: crypto.randomUUID(), bookId, runId: crypto.randomUUID(),
      phase: intervention.phase,
      title: "Intervento dell'autore — " + INTERVENTION_SCOPE_LABELS[input.scope],
      reason: "Indicazione registrata durante: " + intervention.stepLabel,
      nextStep, status: "succeeded", aiRequested: false,
      createdAt: now, endedAt: now,
      summary: summary(instruction), output: instruction,
      interventionId: intervention.id,
    };
    await saveBookWithAuthorActivity(book, activity, expectedUpdatedAt);
    recorded = { intervention, effect };
  });
  if (!recorded) throw new Error("Intervento non registrato.");
  return recorded;
}
