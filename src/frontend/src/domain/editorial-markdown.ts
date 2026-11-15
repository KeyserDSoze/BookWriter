import type { BookProject } from "./types";
import { defaultEditorialProfiles, formatRuleLine, parseEditorialProfiles } from "./editorial-profiles";
import { reviewerLabel, type EditorialReport, type EditorialRound } from "./editorial-board";
import { readMarkdownDocument, writeMarkdownDocument, type MarkdownValue } from "./markdown-document";

function slug(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "untitled";
}
const n = (value: number) => String(value).padStart(3, "0");
function reportMarkdown(report: EditorialReport): string {
  const name = report.reviewerName ?? reviewerLabel(report.role);
  const checklist = report.checklist?.length ? "Checklist delle regole:\n\n" + report.checklist.map(item =>
    "- " + item.ruleId + ": " + ({ pass: "rispettata", fail: "NON rispettata", not_applicable: "non pertinente" })[item.outcome] +
    (item.note ? " — " + item.note : "")).join("\n") + "\n\n" : "";
  return "## " + name + " — segmento " + (report.segmentIndex + 1) + "/" + report.segmentCount + "\n\n" +
    "Esito: " + report.verdict + "\n\n" + report.summary + "\n\n" + checklist +
    report.findings.map(f => "### " + f.id + " — " + f.severity + (f.ruleId ? " — regola " + f.ruleId : "") + "\n\n" +
      "Scena: " + f.sceneId + "\n\nProva testuale:\n\n" + f.evidence +
      "\n\nMotivo:\n\n" + f.reason + "\n\nCorrezione proposta:\n\n" + f.remediation).join("\n\n");
}
export function projectEditorialDocuments(book: BookProject): Record<string, string> {
  const files: Record<string, string> = {};
  const document = (path: string, meta: Record<string, MarkdownValue>, body: string) => {
    const previous = book.markdownSource?.[path];
    files[path] = writeMarkdownDocument({ ...(previous === undefined ? {} : readMarkdownDocument(previous, false).metadata), ...meta }, body);
  };
  const profiles = book.editorialProfiles ? parseEditorialProfiles(book.editorialProfiles) : defaultEditorialProfiles();
  for (const reader of profiles.readers) {
    const path = "profiles/readers/bookwriter-" + reader.id + ".md";
    if (!book.editorialProfiles && book.markdownSource?.[path] !== undefined) continue;
    document(path, { type: "reader_profile", id: reader.id, role: reader.role,
      name: reader.name, enabled: reader.enabled, ...(reader.version ? { version: reader.version } : {}) }, reader.instructions);
  }
  for (const writer of profiles.writers) document("profiles/writers/bookwriter-" + writer.id + ".md", {
    type: "writer_profile", id: writer.id, name: writer.name, strength: writer.strength,
    selected: writer.id === profiles.selectedWriterId, review_enabled: writer.reviewEnabled,
    review_prompt: writer.reviewPrompt,
    ...(writer.rules ? { rules: writer.rules.map(formatRuleLine) } : {}),
    ...(writer.version ? { version: writer.version } : {}),
  }, writer.writingPrompt);
  if (profiles.director) document("profiles/director/bookwriter-director.md", {
    type: "director_profile", ...(profiles.director.version ? { version: profiles.director.version } : {}),
  }, profiles.director.instructions);
  if (profiles.maxRounds !== undefined) document("profiles/board.md", { type: "editorial_board", max_rounds: profiles.maxRounds },
    "Impostazioni della redazione del libro. Il numero di tornate non può superare tre.");
  function round(path: string, chapterId: string, record: Pick<EditorialRound, "round" | "reports"> & Partial<EditorialRound>, state: string) {
    files[path] = writeMarkdownDocument({ type: "editorial_round", chapter: chapterId, round: record.round, state,
      reports: record.reports.length }, "# Review della tornata " + record.round + "\n\n" +
      "Rapporti indipendenti; non sono certificazioni di qualità o di verità.\n\n" +
      record.reports.map(reportMarkdown).join("\n\n---\n\n") + (record.judgment ? "\n\n## Direttore editoriale\n\nEsito: " +
        record.judgment.verdict + "\n\n" + record.judgment.reasoning + "\n\n" +
        (record.judgment.ruleChecks?.length ? "Regole obbligatorie verificate dal direttore:\n\n" + record.judgment.ruleChecks.map(c =>
          "- " + c.ruleId + ": " + (c.verdict === "respected" ? "rispettata" : "violata") + " — " + c.rationale).join("\n") + "\n\n" : "") +
        record.judgment.decisions.map(d => "- " + d.findingId + ": " + d.action + " — " + d.rationale).join("\n") : ""));
  }
  for (const chapter of book.chapters) {
    const folder = "reviews/chapters/" + n(chapter.number) + "-" + slug(chapter.title);
    for (const [i, record] of (chapter.editorialRounds ?? []).entries())
      round(folder + "/archive-" + n(i + 1) + "-round-" + n(record.round) + ".md", chapter.id, record, "archived");
    if (book.editorialCycle?.chapterId === chapter.id) {
      for (const [i, record] of book.editorialCycle.priorRounds.entries())
        round(folder + "/current-prior-" + n(i + 1) + ".md", chapter.id, record, "prior_round");
      round(folder + "/current-round-" + n(book.editorialCycle.round) + ".md", chapter.id, book.editorialCycle, "provisional");
    }
  }
  return files;
}
