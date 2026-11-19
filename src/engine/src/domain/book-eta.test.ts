import { describe, expect, it } from "vitest";
import { describeEta, estimateBookEta, formatDuration } from "./book-eta";
import { newBook, type Activity, type Phase } from "./types";

function task(phase: Phase, seconds: number, outputTokens = 100, minutesAgo = 0): Activity {
  const end = Date.now() - minutesAgo * 60_000;
  return { id: crypto.randomUUID(), bookId: "b", phase, title: phase, reason: "", nextStep: "",
    status: "succeeded", aiRequested: true, createdAt: new Date(end - seconds * 1000).toISOString(),
    endedAt: new Date(end).toISOString(), outputTokens } as Activity;
}
function book() {
  const b = newBook("T", "B", "S", "A");
  b.phase = "prose";
  b.chapters = [{ id: "c1", number: 1, title: "Uno", purpose: "Intro", scenes: [
    { id: "s1", number: 1, title: "A", objective: "o", status: "canon", text: "x".repeat(3000) },
    { id: "s2", number: 2, title: "B", objective: "o", status: "planned", text: "" },
  ] }];
  return b;
}

describe("Stima di velocità e tempo rimanente", () => {
  it("non inventa nulla senza task osservati", () => {
    const eta = estimateBookEta(book(), []);
    expect(eta.observedTasks).toBe(0);
    expect(eta.remainingSeconds).toBeUndefined();
    expect(describeEta(eta)).toBeUndefined();
  });
  it("misura i token al secondo e stima il lavoro rimasto dai task già conclusi", () => {
    const history = [task("prose", 100, 240), task("review", 100, 240), task("consolidate", 50, 60)];
    const eta = estimateBookEta(book(), history);
    expect(eta.tokensPerSecond).toBeCloseTo(540 / 250, 5);
    // 1 prose + 1 review + 1 consolidate (scene 2), then 13 board calls x1 segment + judge = 14 (no data -> mean).
    expect(eta.remainingTasks).toBe(3 + 14);
    expect(eta.partial).toBe(true);
    const overall = 250 / 3;
    expect(eta.remainingSeconds).toBe(Math.round(100 + 100 + 50 + 14 * overall));
    expect(describeEta(eta)).toMatch(/almeno .*un solo giro di revisione/);
  });
  it("non è parziale quando ogni tipo di lavoro rimasto ha già un esempio", () => {
    const history = [task("prose", 60), task("review", 60), task("consolidate", 30), task("chapterReview", 120)];
    const eta = estimateBookEta(book(), history);
    expect(eta.partial).toBe(false);
    expect(eta.remainingSeconds).toBe(60 + 60 + 30 + 14 * 120);
    expect(describeEta(eta)).toMatch(/circa/);
  });
  it("ignora task falliti, interventi e durate impossibili", () => {
    const bad: Activity = { ...task("prose", 10), status: "failed" };
    const note: Activity = { ...task("prose", 10), interventionId: "i1" } as Activity;
    const huge = task("prose", 10); huge.endedAt = new Date(Date.parse(huge.createdAt) + 90 * 3600_000).toISOString();
    expect(estimateBookEta(book(), [bad, note, huge]).observedTasks).toBe(0);
  });
  it("formatta le durate in italiano", () => {
    expect(formatDuration(20)).toBe("meno di un minuto");
    expect(formatDuration(25 * 60)).toBe("25 min");
    expect(formatDuration(3 * 3600)).toBe("3,0 ore");
    expect(formatDuration(30 * 3600)).toBe("30 ore");
    expect(formatDuration(100 * 3600)).toBe("4 giorni");
  });
});
