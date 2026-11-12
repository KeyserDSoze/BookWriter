import { describe, expect, it } from "vitest";
import { newBook, type BookProject } from "./types";
import { createEditorialCycle } from "./editorial-board";
import { bookProgress, describeNextAutopilotStep, pipelineStage } from "./autopilot-step";
import {
  interventionStatusText, markAuthorNotesApplied, pendingAuthorNotes,
  taskAcceptsAuthorNotes, withAuthorNotes,
} from "./author-interventions";

function planned(): BookProject {
  const book = newBook("Un giallo al porto.", "Il porto", "Sobrio", "Adulti");
  book.phase = "prose";
  book.chapters = [
    { id: "c1", number: 1, title: "Arrivo", purpose: "Inizio", frozenAt: "2026-01-01T00:00:00Z",
      scenes: [{ id: "s1", number: 1, title: "Molo", objective: "Arrivo", text: "Mara arriva al molo.", status: "canon" }] },
    { id: "c2", number: 2, title: "Lettera", purpose: "Svolta",
      scenes: [
        { id: "s2", number: 1, title: "Busta", objective: "Trovare la busta", text: "Una busta gialla.", status: "canon" },
        { id: "s3", number: 2, title: "Firma", objective: "Riconoscere la firma", text: "", status: "planned" },
      ] },
  ];
  return book;
}

describe("Descrizione del prossimo passo dell'autopilot", () => {
  it("descrive l'ideazione e la modalità sinossi", () => {
    const book = newBook("", "Titolo", "Stile", "Adulti", { startMode: "synopsis",
      authorChapterSynopses: [{ synopsis: "A" }, { synopsis: "B" }] });
    const step = describeNextAutopilotStep(book);
    expect(step.stage).toBe("ideation");
    expect(step.headline).toMatch(/Brainstorming/);
    expect(step.detail).toMatch(/sinossi di 2 capitoli/);
    expect(step.acceptsAuthorNotes).toBe(true);
    book.phase = "outline";
    expect(describeNextAutopilotStep(book).headline).toBe("Piano delle scene per i 2 capitoli della tua sinossi.");
    book.phase = "audience"; book.audienceReviews = ["1", "2"];
    expect(describeNextAutopilotStep(book).headline).toBe("Panel dei lettori: profilo 3 di 5.");
  });

  it("indica la prossima scena da scrivere con capitolo, numero e obiettivo", () => {
    const step = describeNextAutopilotStep(planned());
    expect(step).toMatchObject({ stage: "writing", chapterNumber: 2, sceneNumber: 2,
      headline: "Scrittura della scena 2 del capitolo 2 «Firma».", detail: "Obiettivo: Riconoscere la firma" });
  });

  it("riconosce un capitolo completo in attesa di redazione e i revisori indipendenti", () => {
    const book = planned();
    book.chapters[1]!.scenes[1]!.text = "La firma è del padre.";
    book.chapters[1]!.scenes[1]!.status = "canon";
    expect(pipelineStage(book)).toBe("editing");
    expect(describeNextAutopilotStep(book).headline).toMatch(/^Redazione del capitolo 2 «Lettera»/);
    book.phase = "chapterReview";
    book.editorialCycle = createEditorialCycle("c2");
    const review = describeNextAutopilotStep(book);
    expect(review.headline).toBe("Redazione del capitolo 2 «Lettera»: revisore 1 di 24 — Coerenza e causalità.");
    expect(review.acceptsAuthorNotes).toBe(false);
    book.editorialCycle.stage = "blocked";
    book.editorialCycle.blockedReason = "Tre tornate senza consenso.";
    expect(describeNextAutopilotStep(book).blocked).toBe("Tre tornate senza consenso.");
  });

  it("descrive revisione, completamento e scene fuse da confermare senza lanciare eccezioni", () => {
    const book = planned();
    book.phase = "revision";
    book.revision = { id: "r", instruction: "Mara arriva in treno.", beforePhase: "prose", affectedSceneIds: [], cursor: 0 };
    expect(describeNextAutopilotStep(book).headline).toBe("Analisi d'impatto della tua revisione.");
    book.revision.impactAnalysis = "ok";
    book.revision.affectedSceneIds = ["s2"];
    expect(describeNextAutopilotStep(book).headline).toMatch(/^Riscrittura retroattiva 1 di 1/);
    book.revision.cursor = 1;
    expect(describeNextAutopilotStep(book).headline).toMatch(/memoria narrativa dopo la revisione/);
    book.revision.affectedSceneIds = ["sparita"]; book.revision.cursor = 0;
    expect(describeNextAutopilotStep(book).blocked).toMatch(/non esiste più/);
    book.editorialReviewSceneIds = ["s2"];
    expect(describeNextAutopilotStep(book).blocked).toMatch(/scene fuse/);
    const done = planned();
    done.phase = "completed"; done.status = "completed";
    expect(describeNextAutopilotStep(done)).toMatchObject({ stage: "done" });
  });

  it("calcola avanzamento, scene canoniche e parole scritte", () => {
    expect(bookProgress(planned())).toEqual({ chapters: 2, frozenChapters: 1, scenes: 3,
      canonScenes: 2, writtenScenes: 2, words: 7 });
  });
});

describe("Note dell'autore per il prossimo passo", () => {
  const book = newBook("Brief", "Titolo", "Stile", "Adulti");
  book.authorInterventions = [
    { id: "a", createdAt: "2026-01-01T00:00:00Z", instruction: "Più ironia.", scope: "next_step", phase: "brainstorm", stepLabel: "x" },
    { id: "b", createdAt: "2026-01-01T00:00:00Z", instruction: "Vincolo.", scope: "from_now", phase: "brainstorm", stepLabel: "x" },
  ];

  it("solo i task di scrittura le ricevono, mai revisori, lettori, giudice o sinossi", () => {
    for (const kind of ["brainstorm", "outline", "prose", "continuity", "consolidate", "revision", "chapterRepair"] as const)
      expect(taskAcceptsAuthorNotes(kind)).toBe(true);
    for (const kind of ["chapterAudit", "chapterReaders", "chapterJudge", "summarize", "merge"] as const)
      expect(taskAcceptsAuthorNotes(kind)).toBe(false);
  });

  it("le aggiunge dopo il prompt e le marca applicate una sola volta", () => {
    const notes = pendingAuthorNotes(book);
    expect(notes.map(n => n.id)).toEqual(["a"]);
    expect(withAuthorNotes("PROMPT", [])).toBe("PROMPT");
    const prompt = withAuthorNotes("PROMPT", notes);
    expect(prompt.startsWith("PROMPT\n\nINDICAZIONI DELL'AUTORE")).toBe(true);
    expect(prompt).toContain("- Più ironia.");
    markAuthorNotesApplied(book, ["a", "b"], "task-1", "Scrittura", "2026-02-01T00:00:00Z");
    expect(book.authorInterventions![0]).toMatchObject({ appliedAt: "2026-02-01T00:00:00Z", appliedActivityId: "task-1" });
    expect(book.authorInterventions![1]!.appliedAt).toBeUndefined();
    markAuthorNotesApplied(book, ["a"], "task-2", "Altro", "2026-03-01T00:00:00Z");
    expect(book.authorInterventions![0]!.appliedActivityId).toBe("task-1");
    expect(pendingAuthorNotes(book)).toEqual([]);
    expect(interventionStatusText(book.authorInterventions![0]!)).toBe("Applicata nel task «Scrittura»");
    expect(interventionStatusText(book.authorInterventions![1]!)).toBe("Vincolo permanente attivo");
  });
});
