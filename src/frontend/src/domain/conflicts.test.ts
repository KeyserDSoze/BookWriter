import { describe, expect, it } from "vitest";
import { newBook, type BookProject } from "./types";
import { assembleBookResolution, compareBookVersions, shortConflictPreview } from "./conflicts";

function sample() {
  const base = newBook("Premessa", "Titolo originale", "Stile iniziale", "Adulti");
  base.chapters = [{
    id: "ch:001", number: 1, title: "Il ponte", purpose: "Svelare la situazione",
    scenes: [{
      id: "s:001", number: 1, title: "Incontro",
      objective: "Rivelare una traccia", text: "Capitolo canonico.",
      status: "canon", summary: "Due persone incontrate",
    }],
  }];
  base.memory.characters.Mara = "Mara possiede la chiave.";
  base.memory.secrets.lettera = "Segreto ancora protetto.";
  base.memory.timeline = ["Giorno 1: arrivo"];
  const local = structuredClone(base);
  const remote = structuredClone(base);
  return { base, local, remote };
}
function sceneText(book: BookProject) {
  return book.chapters[0]!.scenes[0]!?.text;
}

describe("Confronto strutturato e risoluzione esplicita", () => {
  it("riconosce i conflitti bidirezionali e conserva la prosa non selezionata", () => {
    const { base, local, remote } = sample();
    local.chapters[0]!.scenes[0]!.text = "Scena riscritta localmente.";
    remote.chapters[0]!.scenes[0]!.text = "Scena riscritta su GitHub.";
    remote.memory.secrets.lettera = "La lettera è stata bruciata.";
    const entries = compareBookVersions(local, remote, base);
    const scene = entries.find(x => x.kind === "scene");
    const secret = entries.find(x => x.kind === "entity" && x.entityName === "lettera");
    expect(scene?.origin).toBe("both-changed");
    expect(secret?.origin).toBe("only-remote");

    const merged = assembleBookResolution(local, remote, entries, {
      [scene!.id]: "remote",
    });
    expect(sceneText(merged)).toBe("Scena riscritta su GitHub.");
    expect(merged.memory.secrets.lettera).toBe("Segreto ancora protetto.");
    expect(sceneText(local)).toBe("Scena riscritta localmente.");
    expect(sceneText(remote)).toBe("Scena riscritta su GitHub.");
    expect(merged.status).toBe("paused");
    expect(merged.phase).toBe("prose");
  });

  it("mantiene come default ogni differenza locale anche se GitHub è l'unico modificato", () => {
    const { base, local, remote } = sample();
    remote.brief = "Versione remota aggiornata";
    const entries = compareBookVersions(local, remote, base);
    expect(entries.find(x => x.kind === "field" && x.field === "brief")?.origin)
      .toBe("only-remote");
    const merged = assembleBookResolution(local, remote, entries, {});
    expect(merged.brief).toBe("Premessa");
  });

  it("permette di recuperare una scena eliminata e un capitolo aggiunto", () => {
    const { base, local, remote } = sample();
    local.chapters[0]!.scenes = [];
    remote.chapters.push({
      id: "ch:002", number: 2, title: "Il capitolo nuovo",
      purpose: "Un nuovo conflitto", scenes: [],
    });
    const entries = compareBookVersions(local, remote, base);
    expect(entries.some(x => x.kind === "scene" && x.sceneId === "s:001")).toBe(true);
    expect(entries.some(x => x.kind === "chapter" && x.chapterId === "ch:002")).toBe(true);
    const selections = Object.fromEntries(entries.filter(
      x => x.kind === "scene" || x.kind === "chapter",
    ).map(x => [x.id, "remote" as const]));
    const merged = assembleBookResolution(local, remote, entries, selections);
    expect(merged.chapters.map(ch => ch.id)).toEqual(["ch:001", "ch:002"]);
    expect(merged.chapters[0]!.scenes).toHaveLength(1);
  });

  it("l'eliminazione selezionata dal remoto non rende irrecuperabile la copia locale", () => {
    const { local, remote } = sample();
    remote.memory.characters = {};
    remote.chapters = [];
    const entries = compareBookVersions(local, remote);
    const select = Object.fromEntries(entries.map(item => [item.id, "remote"] as const));
    const resolved = assembleBookResolution(local, remote, entries, select);
    expect(resolved.chapters).toHaveLength(0);
    expect(resolved.memory.characters.Mara).toBeUndefined();
    expect(local.chapters).toHaveLength(1);
    expect(local.memory.characters.Mara).toBe("Mara possiede la chiave.");
  });

  it("protegge il nome __proto__ nel canon remoto", () => {
    const { local, remote } = sample();
    Object.defineProperty(remote.memory.characters, "__proto__", {
      value: "Un personaggio con questo nome", enumerable: true, configurable: true,
    });
    const entries = compareBookVersions(local, remote);
    const unit = entries.find(x => x.kind === "entity" && x.entityName === "__proto__")!;
    const merged = assembleBookResolution(local, remote, entries, { [unit.id]: "remote" });
    expect(Object.getPrototypeOf(merged.memory.characters)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(merged.memory.characters, "__proto__")?.value)
      .toBe("Un personaggio con questo nome");
  });

  it("rifiuta versioni di due libri diversi ed espone anteprime limitate", () => {
    const { local, remote } = sample();
    remote.id = crypto.randomUUID();
    expect(() => compareBookVersions(local, remote)).toThrow(/differenti/);
    expect(shortConflictPreview("x".repeat(9000), 60).length).toBeLessThan(80);
  });
});
