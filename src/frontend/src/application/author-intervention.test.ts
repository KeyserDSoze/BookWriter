import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newBook, type BookProject } from "../domain/types";
import { createEditorialCycle } from "../domain/editorial-board";
import { MAX_AUTHOR_INTERVENTIONS } from "../domain/author-interventions";
import { getBook, getDb, saveBook } from "../infrastructure/db";
import { getOutbox } from "../infrastructure/outbox";
import { requestRevision } from "./autopilot";
import { recordAuthorIntervention } from "./author-intervention";

const request = vi.fn(async (
  name: string, _opts: { ifAvailable?: boolean },
  callback: (lock: { name: string } | null) => Promise<unknown>,
) => callback({ name }));
function book(): BookProject {
  return newBook("Una storia lunga", "Libro condiviso", "Prosa sobria", "Adulti");
}
function withPlan(b: BookProject, text = ""): BookProject {
  b.phase = "prose";
  b.status = "paused";
  b.chapters = [{
    id: "chapter:001", number: 1, title: "Arrivo", purpose: "Aprire il mistero",
    scenes: [{ id: "scene:001:001", number: 1, title: "Il porto", objective: "Mara arriva",
      text, status: text ? "canon" : "planned" }],
  }];
  return b;
}
const stored = async (id: string) => (await getBook(id))!;
const activities = async () => await (await getDb()).getAll("activities") as Array<Record<string, unknown>>;
beforeEach(async () => {
  const db = await getDb();
  await db.clear("books"); await db.clear("outbox"); await db.clear("activities");
  request.mockClear();
  vi.stubGlobal("navigator", { locks: { request } });
});
afterEach(() => vi.unstubAllGlobals());

describe("Registro degli interventi dell'autore", () => {
  it("un'indicazione puntuale viene registrata con voce di registro, senza toccare canone o vincoli", async () => {
    const source = book();
    await saveBook(source, false);
    const result = await recordAuthorIntervention(source.id,
      { instruction: "  Il primo capitolo deve aprirsi di notte.  ", scope: "next_step",
        stepLabel: "Brainstorming: idee", activityId: "task-1" }, source.updatedAt);
    const saved = await stored(source.id);
    expect(result.effect).toBe("note");
    expect(saved.authorConstraints).toEqual([]);
    expect(saved.authorInterventions).toEqual([expect.objectContaining({
      instruction: "Il primo capitolo deve aprirsi di notte.", scope: "next_step",
      phase: "brainstorm", stepLabel: "Brainstorming: idee", activityId: "task-1",
    })]);
    expect(saved.authorInterventions![0]!.appliedAt).toBeUndefined();
    expect(saved.phase).toBe("brainstorm");
    expect(saved.status).toBe("idle");
    const log = await activities();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ status: "succeeded", aiRequested: false,
      output: "Il primo capitolo deve aprirsi di notte.",
      interventionId: saved.authorInterventions![0]!.id });
    expect(await getOutbox(source.id)).toBeUndefined();
  });

  it("senza etichetta usa la descrizione del prossimo passo", async () => {
    const source = book();
    await saveBook(source, false);
    await recordAuthorIntervention(source.id, { instruction: "Più ironia.", scope: "next_step" }, source.updatedAt);
    expect((await stored(source.id)).authorInterventions![0]!.stepLabel).toMatch(/Brainstorming/);
  });

  it("un vincolo permanente si aggiunge senza revisione né riscritture", async () => {
    const source = withPlan(book(), "Mara scende dalla nave.");
    await saveBook(source, false);
    const result = await recordAuthorIntervention(source.id,
      { instruction: "Da ora in poi i dialoghi sono più asciutti.", scope: "from_now" }, source.updatedAt);
    const saved = await stored(source.id);
    expect(result.effect).toBe("constraint");
    expect(saved.authorConstraints).toEqual(["Da ora in poi i dialoghi sono più asciutti."]);
    expect(saved.phase).toBe("prose");
    expect(saved.revision).toBeUndefined();
    expect(saved.chapters[0]!.scenes[0]!.text).toBe("Mara scende dalla nave.");
  });

  it("la riscrittura fonde una revisione ancora pendente invece di sostituirla", async () => {
    const source = withPlan(book(), "Mara scende dalla nave.");
    await saveBook(source, false);
    await requestRevision(source.id, "Mara arriva in treno.", source.updatedAt);
    const first = await stored(source.id);
    await recordAuthorIntervention(source.id,
      { instruction: "Il treno è in ritardo.", scope: "rewrite" }, first.updatedAt);
    const second = await stored(source.id);
    expect(second.revision).toMatchObject({
      instruction: "Mara arriva in treno.\nIl treno è in ritardo.", beforePhase: "prose",
    });
    expect(second.authorConstraints).toEqual(["Mara arriva in treno.", "Il treno è in ritardo."]);
    expect(second.authorInterventions?.map(x => x.scope)).toEqual(["rewrite", "rewrite"]);
    expect((await activities()).filter(a => a.interventionId)).toHaveLength(2);
  });

  it("senza testo scritto la riscrittura rifà il piano dei capitoli", async () => {
    const source = withPlan(book());
    source.status = "error";
    source.previousError = "Piano non valido.";
    await saveBook(source, false);
    const result = await recordAuthorIntervention(source.id,
      { instruction: "Il libro deve avere un prologo.", scope: "rewrite" }, source.updatedAt);
    const saved = await stored(source.id);
    expect(result.effect).toBe("replan");
    expect(saved.phase).toBe("outline");
    expect(saved.status).toBe("paused");
    expect(saved.previousError).toBeUndefined();
    expect(saved.revision).toBeUndefined();
    expect(saved.authorConstraints).toEqual(["Il libro deve avere un prologo."]);
  });

  it("senza piano la riscrittura è rifiutata e nulla viene registrato", async () => {
    const source = book();
    await saveBook(source, false);
    await expect(requestRevision(source.id, "Cambia tutto.", source.updatedAt))
      .rejects.toThrow(/Non c'è ancora un piano/);
    expect(await stored(source.id)).toEqual(source);
    expect(await activities()).toEqual([]);
  });

  it("libro completato: niente note puntuali, ma la revisione riapre il lavoro", async () => {
    const source = withPlan(book(), "Fine della storia.");
    source.status = "completed"; source.phase = "completed";
    await saveBook(source, false);
    await expect(recordAuthorIntervention(source.id,
      { instruction: "Più tensione.", scope: "next_step" }, source.updatedAt))
      .rejects.toThrow(/Il libro è completato/);
    await recordAuthorIntervention(source.id,
      { instruction: "Il finale deve essere aperto.", scope: "rewrite" }, source.updatedAt);
    const saved = await stored(source.id);
    expect(saved.status).toBe("paused");
    expect(saved.phase).toBe("revision");
    expect(saved.revision?.beforePhase).toBe("completed");
  });

  it("redazione bloccata o in correzione: niente riscrittura, ma le note restano registrabili", async () => {
    const source = withPlan(book(), "Mara scende dalla nave.");
    source.phase = "chapterReview";
    source.editorialCycle = { ...createEditorialCycle("chapter:001"), stage: "blocked" };
    await saveBook(source, false);
    await expect(requestRevision(source.id, "Cambia le scene.", source.updatedAt))
      .rejects.toThrow(/redazione del capitolo è bloccata/);
    const repairing = await stored(source.id);
    repairing.editorialCycle = { ...createEditorialCycle("chapter:001"), stage: "repair" };
    await saveBook(repairing, false);
    await expect(requestRevision(source.id, "Cambia le scene.", repairing.updatedAt))
      .rejects.toThrow(/sta applicando correzioni/);
    await recordAuthorIntervention(source.id,
      { instruction: "Più ironia nei dialoghi.", scope: "next_step" }, repairing.updatedAt);
    const saved = await stored(source.id);
    expect(saved.revision).toBeUndefined();
    expect(saved.editorialCycle?.stage).toBe("repair");
    expect(saved.authorInterventions?.map(x => x.instruction)).toEqual(["Più ironia nei dialoghi."]);
  });

  it("consente la riscrittura durante la revisione indipendente senza perdere il ciclo", async () => {
    const source = withPlan(book(), "Mara scende dalla nave.");
    source.phase = "chapterReview";
    source.editorialCycle = createEditorialCycle("chapter:001");
    await saveBook(source, false);
    await requestRevision(source.id, "Mara non deve sorridere.", source.updatedAt);
    const saved = await stored(source.id);
    expect(saved.phase).toBe("revision");
    expect(saved.revision?.beforePhase).toBe("chapterReview");
    expect(saved.editorialCycle?.stage).toBe("review");
  });

  it("rifiuta testo troppo lungo e registro pieno senza scrivere", async () => {
    const source = book();
    await saveBook(source, false);
    await expect(recordAuthorIntervention(source.id,
      { instruction: "x".repeat(8001), scope: "next_step" }, source.updatedAt)).rejects.toThrow(/troppo lungo/);
    expect(request).not.toHaveBeenCalled();
    const full = await stored(source.id);
    full.authorInterventions = Array.from({ length: MAX_AUTHOR_INTERVENTIONS }, (_, i) => ({
      id: "i" + i, createdAt: new Date(0).toISOString(), instruction: "nota " + i,
      scope: "from_now" as const, phase: "brainstorm" as const, stepLabel: "Brainstorming",
    }));
    await saveBook(full, false);
    await expect(recordAuthorIntervention(source.id,
      { instruction: "Una nota in più.", scope: "next_step" }, full.updatedAt))
      .rejects.toThrow(/Registro degli interventi pieno/);
    expect((await stored(source.id)).authorInterventions).toHaveLength(MAX_AUTHOR_INTERVENTIONS);
    expect(await activities()).toEqual([]);
  });
});
