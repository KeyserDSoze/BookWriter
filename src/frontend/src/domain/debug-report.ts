import type { Activity, BookProject } from "./types";
import { explainAutopilotError } from "./autopilot-error";
import { describeNextAutopilotStep } from "./autopilot-step";
import { activeManualReview } from "./manual-review";
import { activeChange } from "./narrative-change";

export interface DebugReportOptions {
  version: string;
  now: string;
  userAgent?: string;
  /** Failed or cancelled tasks to list (newest first). */
  maxFailures?: number;
  /** Latest tasks of any status, to show what happened around the error. */
  maxRecent?: number;
}

const clip = (text: string, max: number) => text.length > max ? text.slice(0, max) + "… [troncato]" : text;
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** Keys, bearer tokens and secret URL parameters never leave the app in a copied report. */
export function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redatto]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[token redatto]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[token redatto]")
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}\b/g, "[chiave redatta]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[chiave redatta]")
    .replace(/([?&](?:key|api_key|apikey|token|access_token|code|secret|sig|signature)=)[^&\s"')]+/gi, "$1[redatto]");
}
const safe = (text: string, max: number) => clip(redactSecrets(oneLine(text)), max);

function duration(activity: Activity): string {
  if (!activity.endedAt) return activity.status === "running" ? "ancora in corso" : "durata sconosciuta";
  const ms = Date.parse(activity.endedAt) - Date.parse(activity.createdAt);
  if (!Number.isFinite(ms) || ms < 0) return "durata sconosciuta";
  return ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60_000)} min`;
}
function tokens(activity: Activity): string {
  const known = activity.inputTokens !== undefined || activity.outputTokens !== undefined;
  return known ? `token ${activity.inputTokens ?? "?"} in / ${activity.outputTokens ?? "?"} out` : activity.aiRequested ? "token non comunicati (richiesta inviata)" : "nessuna richiesta AI";
}
function activityLine(activity: Activity): string {
  const model = activity.endpointId || activity.modelId ? ` · ${activity.endpointId ?? "?"}/${activity.modelId ?? "?"}` : "";
  return `- ${activity.createdAt} · ${activity.status.toUpperCase()} · fase ${activity.phase} · «${safe(activity.title, 160)}»${model} · ${duration(activity)} · ${tokens(activity)}`;
}

/** A Markdown prompt for the developer: state, recent errors and what is known about each. It never contains
 * prose, memory, secrets, prompts or model answers: only titles, phases, models and the error messages. */
export function buildDebugReport(book: BookProject, activities: readonly Activity[], options: DebugReportOptions): string {
  const maxFailures = options.maxFailures ?? 6, maxRecent = options.maxRecent ?? 8;
  const mine = activities.filter(a => a.bookId === book.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const failures = mine.filter(a => a.status === "failed" || a.status === "cancelled" || !!a.error).slice(0, maxFailures);
  const lines: string[] = [];
  lines.push(`# Debug di BookWriter ${options.version}`, "",
    `Generato il ${options.now}${options.userAgent ? " · " + safe(options.userAgent, 160) : ""}.`, "",
    "Sono lo sviluppatore di BookWriter. Qui sotto c'è lo stato del libro e gli ultimi errori. Dimmi dove è andato in errore, perché (causa probabile, distinguendo ciò che è certo da ciò che è un'ipotesi), cosa controllare e proponi la correzione nel codice. Se ti serve un file o un log in più, chiedimelo.", "",
    "## Stato del libro",
    `- Libro: «${safe(book.title, 120)}» (${book.id})`,
    `- Stato: ${book.status} · fase: ${book.phase} · capitoli ${book.chapters.length}, congelati ${book.chapters.filter(c => c.frozenAt).length}`);
  try {
    const step = describeNextAutopilotStep(book);
    lines.push(`- Prossimo passo: ${safe(step.headline, 200)}${step.detail ? " — " + safe(step.detail, 240) : ""}${step.blocked ? " · BLOCCATO: " + safe(step.blocked, 240) : ""}`);
  } catch (error) { lines.push(`- Prossimo passo: non calcolabile (${safe(error instanceof Error ? error.message : String(error), 200)})`); }
  if (book.editorialCycle) {
    const cycle = book.editorialCycle;
    const chapter = book.chapters.find(c => c.id === cycle.chapterId);
    lines.push(`- Redazione: capitolo ${chapter?.number ?? "?"}, tornata ${cycle.round}, stage ${cycle.stage}, rapporti ${cycle.reports.length}${cycle.blockedReason ? ", motivo del blocco: " + safe(cycle.blockedReason, 300) : ""}`);
  }
  if (book.revision) lines.push(`- Revisione in corso (fase di partenza ${book.revision.beforePhase}), scene toccate ${book.revision.affectedSceneIds.length}, cursore ${book.revision.cursor}`);
  const change = activeChange(book);
  if (change) lines.push(`- Modifica tracciata in corso: ${change.target.kind} «${safe(change.targetLabel, 100)}» · stato ${change.state}${change.fromEdits?.length ? " · da modifica salvata" : ""}${change.error ? " · errore: " + safe(change.error, 400) : ""}`);
  const review = activeManualReview(book);
  if (review) lines.push(`- Review su richiesta: ${review.scope}/${review.mode}, fase ${review.stage}, stato ${review.status}${review.error ? " · errore: " + safe(review.error, 400) : ""}`);
  if (book.aiBudget?.enabled) lines.push("- Budget AI attivo");

  lines.push("", "## Ultimo errore registrato nel libro");
  if (book.previousError) {
    const help = explainAutopilotError(book.previousError);
    lines.push(`> ${safe(book.previousError, 1200)}`, "", `Spiegazione dell'app: ${help.meaning} ${help.action}`);
  } else lines.push("Nessun errore segnalato dal libro in questo momento.");

  const failedChanges = (book.changeOperations ?? []).filter(op => op.state === "failed" || !!op.error).slice(-3).reverse();
  const failedReviews = (book.manualReviews ?? []).filter(r => !!r.error).slice(-3).reverse();
  if (failedChanges.length || failedReviews.length) {
    lines.push("", "## Modifiche e review non riuscite");
    for (const op of failedChanges) lines.push(`- Modifica ${op.target.kind} «${safe(op.targetLabel, 100)}» (${op.state}, ${op.updatedAt}): ${safe(op.error ?? "senza messaggio", 500)}`);
    for (const r of failedReviews) lines.push(`- Review ${r.scope}/${r.mode} (${r.status}, ${r.createdAt}): ${safe(r.error ?? "", 500)}`);
  }

  lines.push("", `## Ultimi task falliti o interrotti (${failures.length})`);
  if (!failures.length) lines.push("Nessun task fallito o interrotto nel registro.");
  failures.forEach((activity, index) => {
    lines.push("", `### ${index + 1}. ${safe(activity.title, 160)}`, activityLine(activity),
      `- Perché lo faceva: ${safe(activity.reason, 300)}`,
      `- Prossimo passo previsto: ${safe(activity.nextStep, 200)}`,
      `- Errore: ${activity.error ? safe(activity.error, 1500) : "(nessun messaggio salvato)"}`);
    if (activity.error) lines.push(`- Lettura dell'app: ${explainAutopilotError(activity.error).meaning}`);
  });

  lines.push("", `## Cosa è successo subito prima (ultimi ${Math.min(maxRecent, mine.length)} task, dal più recente)`);
  if (!mine.length) lines.push("Nessun task nel registro.");
  for (const activity of mine.slice(0, maxRecent)) lines.push(activityLine(activity));
  lines.push("", "_Il report non contiene testo del libro, memoria, segreti, prompt o risposte del modello; chiavi e token sono redatti. Gli errori mostrati solo a schermo e non salvati (per esempio un salvataggio rifiutato) non compaiono: descrivimeli a parte._");
  return lines.join("\n");
}
