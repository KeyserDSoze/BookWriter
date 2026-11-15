import type { BookProject } from "./types";
import { writeMarkdownDocument } from "./markdown-document";
import { CHANGE_KIND_LABELS, findScene, REVIEW_STATE_LABELS, type EditTargetKind } from "./book-edits";
import { REVIEW_MODE_LABELS, REVIEW_SCOPE_LABELS, type ManualReview } from "./manual-review";

/** Readable history of the author's edits and of the reviews they asked for, next to the
 * book (Markdown format 3). It is documentation for people and other tools: it is NOT
 * re-imported as live data; `.bookwriter/project.json` stays the lossless source. */
const TARGET_LABELS: Record<EditTargetKind, string> = {
  scene: "Scena", chapter: "Capitolo", entity: "Scheda", event: "Evento", timeline: "Timeline", structure: "Struttura", profiles: "Agenti",
};
const REVIEW_STATUS: Record<ManualReview["status"], string> = { pending: "in coda", in_progress: "in corso", completed: "completata", cancelled: "annullata" };
const OUTCOME: Record<NonNullable<ManualReview["outcome"]>, string> = { passed: "superata", failed: "problemi trovati", analysis: "analisi d'impatto" };
const UNIT_STATUS: Record<ManualReview["units"][number]["status"], string> = { pending: "non controllato", done: "controllato", failed: "non riuscito", skipped: "saltato" };
const SEVERITY: Record<ManualReview["findings"][number]["severity"], string> = { critical: "critico", major: "importante", minor: "minore" };
const RISK: Record<NonNullable<ManualReview["impacts"]>[number]["risk"], string> = { high: "alto", medium: "medio", low: "basso" };
const PROPOSAL: Record<ManualReview["proposals"][number]["status"], string> = { proposed: "da approvare", applied: "applicata", rejected: "rifiutata", stale: "superata da altre modifiche" };

/** One line of untrusted text: no Markdown structure can be injected through a label. */
const line = (value: string, max: number) => value.replace(/\s+/g, " ").trim().slice(0, max);
const when = (iso: string) => iso.slice(0, 16).replace("T", " ");

function sceneLabel(book: BookProject, sceneId: string): string {
  const found = findScene(book, sceneId);
  return found ? `cap. ${found.chapter.number}, scena ${found.scene.number} «${line(found.scene.title, 80)}»` : "scena " + line(sceneId, 80);
}

function reviewDocument(book: BookProject, review: ManualReview): string {
  const meta = {
    type: "manual_review", id: review.id, scope: review.scope, mode: review.mode,
    ...(review.engine ? { engine: review.engine } : {}), status: review.status,
    ...(review.outcome ? { outcome: review.outcome } : {}), created: review.createdAt,
    ...(review.completedAt ? { completed: review.completedAt } : {}),
  };
  const body = [
    `# ${REVIEW_SCOPE_LABELS[review.scope].label} — ${review.engine === "board" ? "redazione completa" : REVIEW_MODE_LABELS[review.mode].label.toLowerCase()}`, "",
    `Richiesta il ${when(review.createdAt)} · ${REVIEW_STATUS[review.status]}` + (review.outcome ? ` · esito: ${OUTCOME[review.outcome]}` : ""),
    ...(review.engine === "board" ? ["", "Rapporti, giudizi e correzioni della redazione sono nelle revisioni di ciascun capitolo (`reviews/chapters/`)."] : []),
    ...(review.summary ? ["", line(review.summary, 3000)] : []),
    ...(review.error ? ["", "Errore: " + line(review.error, 1000)] : []),
    ...(review.units.length ? ["", "## Elementi controllati", "",
      ...review.units.map(unit => `- ${line(unit.label, 160)}${unit.edited ? " (modificato)" : ""}: ${UNIT_STATUS[unit.status]}` + (unit.note ? ` — ${line(unit.note, 500)}` : ""))] : []),
    ...(review.impacts?.length ? ["", "## Possibili conseguenze", "",
      ...review.impacts.map(impact => `- Rischio ${RISK[impact.risk]} · ${line(impact.label, 160)}: ${line(impact.reason, 800)}`)] : []),
    ...(review.findings.length ? ["", "## Rilievi", "",
      ...review.findings.map(finding => `- [${SEVERITY[finding.severity]}] ${line(finding.issue, 1500)}` +
        (finding.sceneId ? ` (${sceneLabel(book, finding.sceneId)})` : "") + ` — suggerimento: ${line(finding.suggestion, 1800)}` +
        (finding.evidence ? ` — citazione: «${line(finding.evidence, 400)}»` : ""))] : []),
    ...(review.proposals.length ? ["", "## Correzioni", "",
      ...review.proposals.map(proposal => `- ${sceneLabel(book, proposal.sceneId)}: ${PROPOSAL[proposal.status]} (${proposal.findingIds.length} ${proposal.findingIds.length === 1 ? "rilievo" : "rilievi"})`)] : []),
  ];
  return writeMarkdownDocument(meta, body.join("\n") + "\n");
}

export function editHistoryDocuments(book: BookProject): Record<string, string> {
  const files: Record<string, string> = {};
  const edits = book.edits ?? [];
  if (edits.length) {
    const body = [
      "# Registro delle modifiche", "",
      "Ogni modifica manuale o AI di un elemento del libro, dalla più recente. Le copie complete prima e dopo, quando ancora conservate, sono nello snapshot `.bookwriter/project.json`.", "",
      ...[...edits].reverse().map(edit => `- ${when(edit.at)} · ${TARGET_LABELS[edit.target.kind]} «${line(edit.label, 160)}» · ${line(edit.field, 60)} · ` +
        `${CHANGE_KIND_LABELS[edit.changeKind]} · ${edit.origin === "ai" ? "AI" : "manuale"} · ${REVIEW_STATE_LABELS[edit.reviewState]}` +
        (edit.prompt ? ` — richiesta: ${line(edit.prompt, 300)}` : "")),
    ];
    files["history/edits.md"] = writeMarkdownDocument({ type: "edit_history", count: edits.length }, body.join("\n") + "\n");
  }
  for (const review of book.manualReviews ?? []) {
    const day = /^\d{4}-\d{2}-\d{2}/.test(review.createdAt) ? review.createdAt.slice(0, 10) : "senza-data";
    files[`reviews/manual/${day}-${review.id.slice(0, 8)}.md`] = reviewDocument(book, review);
  }
  return files;
}
