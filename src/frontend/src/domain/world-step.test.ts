import { describe, expect, it } from "vitest";
import { knowledgeBook } from "./__fixtures__/knowledge";
import { describeNextAutopilotStep } from "./autopilot-step";
import { emptyKnowledge } from "./knowledge";
import { parseRoute, formatRoute } from "../application/route";

describe("La Dashboard racconta i nuovi passi", () => {
  it("schede in arrivo e ogni fase di una modifica tracciata", () => {
    const book = knowledgeBook();
    book.knowledge = emptyKnowledge(true);
    expect(describeNextAutopilotStep(book).headline).toBe("Schede narrative, eventi e timeline del libro.");
    const changed = knowledgeBook();
    const op = { id: crypto.randomUUID(), createdAt: "x", updatedAt: "x", target: { kind: "scene" as const, id: "scene:001:002" }, targetLabel: "Il registro",
      instruction: "Più tensione.", mode: "auto" as const, state: "pending" as const, before: { scenes: [] }, report: [] };
    changed.changeOperations = [op];
    changed.revision = { id: "r", instruction: "x", beforePhase: "prose", affectedSceneIds: [], cursor: 0, changeOperationId: op.id };
    changed.phase = "revision";
    expect(describeNextAutopilotStep(changed).headline).toBe("Riscrittura su richiesta: «Il registro».");
    op.state = "analyzing" as never;
    expect(describeNextAutopilotStep(changed).headline).toBe("Confronto della modifica: «Il registro».");
    op.state = "awaiting_confirmation" as never;
    expect(describeNextAutopilotStep(changed).blocked).toMatch(/Mondo/);
    op.target = { kind: "entity", id: "character:elena" } as never; op.state = "pending" as never; op.targetLabel = "Elena";
    expect(describeNextAutopilotStep(changed).headline).toBe("Analisi della modifica di «Elena».");
  });
  it("la pagina Mondo ha il suo indirizzo e i vecchi link «memoria» funzionano ancora", () => {
    expect(formatRoute({ page: "atlas", book: "b1" })).toBe("/worldbuilding?book=b1");
    expect(parseRoute("#/memoria?book=b1")).toEqual({ page: "atlas", book: "b1" });
    expect(parseRoute("/mondo")).toEqual({ page: "atlas" });
  });
});
