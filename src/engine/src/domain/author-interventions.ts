import type { AuthorIntervention, AuthorInterventionScope, BookProject, TaskKind } from "./types";

export const MAX_AUTHOR_INTERVENTIONS = 500;
export const MAX_INTERVENTION_CHARS = 8000;

export const INTERVENTION_SCOPE_LABELS: Record<AuthorInterventionScope, string> = {
  next_step: "Solo per il prossimo passo",
  from_now: "Da ora in poi (vincolo permanente)",
  rewrite: "Rivedi anche il già scritto",
};
export const INTERVENTION_SCOPE_HELP: Record<AuthorInterventionScope, string> = {
  next_step: "Indicazione puntuale: viene inviata al prossimo task di scrittura (anche se lo ripete dopo la pausa) e poi archiviata come applicata. I revisori indipendenti e i cinque lettori ciechi non la ricevono.",
  from_now: "Diventa un vincolo inderogabile per tutti i task successivi. Il testo già scritto non viene riscritto.",
  rewrite: "Diventa un vincolo inderogabile e l'autopilot analizza l'impatto, riscrive le scene coinvolte e le successive, poi aggiorna la memoria e ripete la redazione dei capitoli toccati. Se esiste solo il piano, viene rifatto il piano dei capitoli.",
};

/** Tasks that write or plan the book: they already see the private canon.
 * Independent reviewers, blind readers, the judge and summaries never get notes. */
const NOTE_TASKS: ReadonlySet<TaskKind> = new Set<TaskKind>([
  "brainstorm", "validate", "audience", "adversarial", "outline", "prose",
  "continuity", "consolidate", "revision", "chapterRepair",
]);
export function taskAcceptsAuthorNotes(kind: TaskKind): boolean {
  return NOTE_TASKS.has(kind);
}

export function pendingAuthorNotes(book: Pick<BookProject, "authorInterventions">): AuthorIntervention[] {
  return (book.authorInterventions ?? []).filter(entry => entry.scope === "next_step" && !entry.appliedAt);
}

const SCOPES = new Set<unknown>(["next_step", "from_now", "rewrite"]);
/** Untrusted snapshot (e.g. a GitHub repository): keep only well-formed, bounded entries. */
export function sanitizeAuthorInterventions(value: unknown): AuthorIntervention[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const optional = (field: unknown) => field === undefined || typeof field === "string";
  return value.filter((entry): entry is AuthorIntervention => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Record<string, unknown>;
    return typeof item.id === "string" && typeof item.createdAt === "string" &&
      typeof item.instruction === "string" && item.instruction.length > 0 &&
      item.instruction.length <= MAX_INTERVENTION_CHARS && SCOPES.has(item.scope) &&
      typeof item.phase === "string" && typeof item.stepLabel === "string" &&
      optional(item.activityId) && optional(item.appliedAt) &&
      optional(item.appliedActivityId) && optional(item.appliedStepLabel);
  }).slice(-MAX_AUTHOR_INTERVENTIONS);
}

/** Appended after the task prompt so the requested output format stays the last instruction. */
export function withAuthorNotes(prompt: string, notes: readonly AuthorIntervention[]): string {
  if (!notes.length) return prompt;
  return prompt + "\n\n" + [
    "INDICAZIONI DELL'AUTORE PER QUESTO PASSO (prioritarie, registrate durante la supervisione):",
    ...notes.map(note => "- " + note.instruction),
    "Applicale in questo task. Non contraddire i vincoli inderogabili; se un'indicazione riguarda un momento successivo, preparane le premesse senza anticiparla. Mantieni esattamente il formato di risposta richiesto sopra.",
  ].join("\n");
}

/** Mark only the exact notes that were sent in a task that has just succeeded. */
export function markAuthorNotesApplied(
  book: BookProject, ids: readonly string[], activityId: string, stepLabel: string, at: string,
): void {
  if (!ids.length) return;
  const wanted = new Set(ids);
  for (const entry of book.authorInterventions ?? []) {
    if (!wanted.has(entry.id) || entry.scope !== "next_step" || entry.appliedAt) continue;
    entry.appliedAt = at;
    entry.appliedActivityId = activityId;
    entry.appliedStepLabel = stepLabel.slice(0, 300);
  }
}

export function interventionStatusText(entry: AuthorIntervention): string {
  if (entry.scope === "next_step")
    return entry.appliedAt
      ? "Applicata nel task «" + (entry.appliedStepLabel ?? "task") + "»"
      : "In attesa del prossimo task di scrittura";
  if (entry.scope === "from_now") return "Vincolo permanente attivo";
  return "Vincolo permanente + revisione retroattiva richiesta";
}
