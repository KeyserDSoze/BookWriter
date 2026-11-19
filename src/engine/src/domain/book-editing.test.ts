import { describe, expect, it } from "vitest";
import { knowledgeBook } from "./__fixtures__/knowledge";
import { createEditorialCycle } from "./editorial-board";
import { currentStamp, elementReviewState, MAX_EDIT_SNAPSHOT_CHARS, pendingElements, pruneEdits, setReviewState } from "./book-edits";
import { addEntity, addEvent, assertEditable, deleteEntity, deleteEvent, deleteTimeline, editChapter, editEntity, editEvent, editMemory, editScene,
  editSceneMetadata, editStructure, editTimeline, moveEvent, restoreBefore, type EditContext } from "./book-editing";
import { followChangeEdits } from "./narrative-change-flow";
import { memoryLabel, memoryValue, parseMemoryId } from "./book-edits";

const ctx = (at = "2026-11-14T10:00:00.000Z"): EditContext => ({ now: at, origin: "manual" });
const scene = (book: ReturnType<typeof knowledgeBook>, id: string) => book.chapters.flatMap(c => c.scenes).find(s => s.id === id)!;

describe("Modifiche manuali: scene e capitoli", () => {
  it("chi c'è nella scena, punto di vista e data: modifica a s\u00e9, confrontabile e ripristinabile, senza toccare l'impronta del testo", () => {
    const book = knowledgeBook();
    const target = { kind: "scene" as const, id: "scene:001:002" };
    const stamp = currentStamp(book, target);
    const edit = editSceneMetadata(book, "scene:001:002", { viewpoint: "Elena", date: " inverno 1923 ", characters: ["Elena", "Markus", "elena", " "] }, ctx());
    expect(edit).toMatchObject({ changeKind: "descriptive", reviewState: "modified_unreviewed", target });
    expect(edit.field).toBe("metadati: punto di vista+data+personaggi");
    expect(edit.related).toEqual(expect.arrayContaining(["character:elena", "character:markus"]));
    expect(scene(book, "scene:001:002")).toMatchObject({ viewpoint: "Elena", date: "inverno 1923", characters: ["Elena", "Markus"] });
    // The prose stamp is unchanged: old validations of the text are not invalidated by a metadata change.
    expect(currentStamp(book, target)).toBe(stamp);
    expect(book.chapters[0]!.reviewStale!.editIds).toContain(edit.id);
    expect(() => editSceneMetadata(book, "scene:001:002", { viewpoint: "Elena" }, ctx())).toThrow(/Nessuna modifica/);
    expect(() => editSceneMetadata(book, "scene:001:002", { items: Array.from({ length: 41 }, (_, i) => "Oggetto " + i) }, ctx())).toThrow(/massimo 40/);
    const restored = restoreBefore(book, edit.id, ctx("2026-11-14T11:00:00.000Z"));
    expect(restored.field).toMatch(/^metadati/);
    expect(scene(book, "scene:001:002").viewpoint).toBeUndefined();
    expect(scene(book, "scene:001:002").date).toBe(JSON.parse(edit.before!).date || undefined);
  });
  it("un evento si colloca in un capitolo e nella cronologia della storia, e si ripristina", () => {
    const book = knowledgeBook();
    const event = book.knowledge!.events.find(e => e.id === "event:primo-indizio")!;
    const edit = editEvent(book, event.id, { plannedChapter: 2, storyOrder: 7.5 }, ctx());
    expect(edit.changeKind).toBe("structural");
    expect(book.knowledge!.events.find(e => e.id === event.id)).toMatchObject({ plannedChapter: 2, storyOrder: 7.5 });
    editEvent(book, event.id, { plannedChapter: null }, ctx());
    expect(book.knowledge!.events.find(e => e.id === event.id)!.plannedChapter).toBeUndefined();
    expect(() => editEvent(book, event.id, { storyOrder: Number.NaN }, ctx())).toThrow(/cronologia/);
    expect(() => editEvent(book, event.id, { plannedChapter: 0 }, ctx())).toThrow(/Capitolo previsto/);
    restoreBefore(book, edit.id, ctx());
    expect(book.knowledge!.events.find(e => e.id === event.id)).toMatchObject({ storyOrder: event.storyOrder });
    expect(book.knowledge!.events.find(e => e.id === event.id)!.plannedChapter).toBe(event.plannedChapter);
  });
  it("salvare non valida: la modifica resta da rivedere, il capitolo congelato resta congelato ma segnato", () => {
    const book = knowledgeBook();
    const edit = editScene(book, "scene:001:002", { text: "Nell'archivio municipale Elena sfoglia il registro con calma e trova una firma cancellata." }, ctx());
    expect(edit).toMatchObject({ origin: "manual", reviewState: "modified_unreviewed", changeKind: "style", field: "testo", target: { kind: "scene", id: "scene:001:002" } });
    expect(edit.related).toContain("scene:002:001");
    expect(book.chapters[0]!.frozenAt).toBeDefined();
    expect(book.chapters[0]!.reviewStale).toEqual({ since: "2026-11-14T10:00:00.000Z", editIds: [edit.id] });
    expect(scene(book, "scene:001:002").summaryStale).toBe(true);
    expect(book.chapters[0]!.summaryStale).toBe(true);
    expect(elementReviewState(book, { kind: "scene", id: "scene:001:002" })).toBe("modified_unreviewed");
    expect(() => editScene(book, "scene:001:002", { text: scene(book, "scene:001:002").text }, ctx())).toThrow(/Nessuna modifica/);
    expect(() => editScene(book, "scene:001:002", { text: "   " }, ctx())).toThrow(/non può restare vuota/);
  });
  it("un cambio di fatti è classificato come evento; un riassunto scritto a mano non è più «non aggiornato»", () => {
    const book = knowledgeBook();
    const edit = editScene(book, "scene:002:001", { text: "Uno sconosciuto aspetta al porto. Dice di conoscere il Consiglio cittadino." }, ctx());
    expect(edit.changeKind).toBe("event");
    editScene(book, "scene:002:001", { summary: "Markus si presenta al porto di Trieste." }, ctx());
    expect(scene(book, "scene:002:001").summaryStale).toBeUndefined();
    const chapter = editChapter(book, "chapter:002", { title: "L'informatore del porto", summary: "Markus parla al porto." }, ctx());
    expect(chapter).toMatchObject({ field: "titolo+riassunto", changeKind: "descriptive" });
    expect(book.chapters[1]!.summaryStale).toBeUndefined();
    expect(book.chapters[1]!.reviewStale!.editIds).toHaveLength(3);
  });
  it("una scena pianificata scritta dall'autore diventa canone e, se era la prossima, aggiorna la memoria senza riscriverla", () => {
    const book = knowledgeBook();
    book.chapters[1]!.frozenAt = undefined;
    book.chapters[1]!.scenes.push({ id: "scene:002:003", number: 3, title: "Il tram", objective: "Fuga", text: "", status: "planned" });
    editScene(book, "scene:002:003", { text: "Elena sale sul tram e guarda Markus allontanarsi." }, ctx());
    expect(scene(book, "scene:002:003").status).toBe("canon");
    expect(book).toMatchObject({ phase: "consolidate", currentSceneId: "scene:002:003" });
  });
  it("la bozza in revisione scritta dall'autore non viene più riscritta dall'AI", () => {
    const book = knowledgeBook();
    book.phase = "review"; book.currentSceneId = "scene:002:002"; scene(book, "scene:002:002").status = "draft";
    editScene(book, "scene:002:002", { text: "Elena capisce tutto. Tace." }, ctx());
    expect(scene(book, "scene:002:002").status).toBe("canon");
    expect(book.phase).toBe("consolidate");
  });
  it("una redazione in corso sul capitolo modificato (o su uno successivo) riparte sul testo nuovo", () => {
    const book = knowledgeBook();
    book.chapters[1]!.frozenAt = undefined;
    book.editorialCycle = createEditorialCycle("chapter:002", book);
    book.editorialCycle.stage = "repair";
    book.phase = "chapterReview";
    scene(book, "scene:002:001").status = "draft";
    editScene(book, "scene:001:001", { text: "Elena ricorda la notte in cui il fratello non tornò. Aveva tredici anni." }, ctx());
    expect(book.editorialCycle).toBeUndefined();
    expect(book.phase).toBe("prose");
    expect(scene(book, "scene:002:001").status).toBe("canon");
  });
  it("non tocca una scena che la revisione in corso sta per riscrivere", () => {
    const book = knowledgeBook();
    book.revision = { id: "rev-1", instruction: "Più tensione", beforePhase: "prose", affectedSceneIds: ["scene:002:001"], cursor: 0, impactAnalysis: "x" };
    expect(() => assertEditable(book, ["scene:002:001"])).toThrow(/sta per essere riscritta/);
    expect(() => editScene(book, "scene:002:001", { title: "Altro" }, ctx())).toThrow(/sta per essere riscritta/);
    expect(() => editStructure(book, { op: "addChapter", index: 2, title: "Nuovo", purpose: "" }, ctx())).toThrow(/revisione/);
  });
});

describe("Struttura del libro", () => {
  it("aggiunge, sposta, elimina e ripristina scene con ID stabili e numerazione coerente", () => {
    const book = knowledgeBook();
    const added = editStructure(book, { op: "addScene", chapterId: "chapter:001", index: 1, title: "La biblioteca", objective: "Una deviazione" }, ctx());
    const newId = added.related[0]!;
    expect(newId).toMatch(/^scene:x[0-9a-f]{10}$/);
    expect(book.chapters[0]!.scenes.map(s => [s.id, s.number])).toEqual([["scene:001:001", 1], [newId, 2], ["scene:001:002", 3]]);
    editStructure(book, { op: "moveScene", sceneId: newId, chapterId: "chapter:002", index: 0 }, ctx());
    expect(book.chapters[1]!.scenes[0]!.id).toBe(newId);
    expect(book.chapters[0]!.scenes.map(s => s.number)).toEqual([1, 2]);
    const removed = editStructure(book, { op: "deleteScene", sceneId: "scene:002:002" }, ctx());
    expect(book.knowledge!.events.find(e => e.id === "event:rivelazione-del-complotto")!.sceneIds).toEqual([]);
    expect(book.chapters[1]!.reviewStale!.editIds).toContain(removed.id);
    restoreBefore(book, removed.id, ctx());
    expect(book.chapters[1]!.scenes.map(s => s.id)).toEqual([newId, "scene:002:001", "scene:002:002"]);
    expect(() => editStructure(book, { op: "moveScene", sceneId: newId, chapterId: "chapter:002", index: 0 }, ctx())).toThrow(/già in quella posizione/);
  });
  it("capitoli: nuovo, spostato, eliminato (mai l'ultimo) e ripristinato", () => {
    const book = knowledgeBook();
    const added = editStructure(book, { op: "addChapter", index: 1, title: "Interludio", purpose: "Una pausa" }, ctx());
    const id = added.related[0]!;
    expect(book.chapters.map(c => [c.id, c.number])).toEqual([["chapter:001", 1], [id, 2], ["chapter:002", 3]]);
    editStructure(book, { op: "moveChapter", chapterId: id, index: 2 }, ctx());
    expect(book.chapters.map(c => c.id)).toEqual(["chapter:001", "chapter:002", id]);
    const deleted = editStructure(book, { op: "deleteChapter", chapterId: "chapter:001" }, ctx());
    expect(book.chapters.map(c => c.number)).toEqual([1, 2]);
    expect(book.knowledge!.events.find(e => e.id === "event:primo-indizio")!.sceneIds).toEqual([]);
    restoreBefore(book, deleted.id, ctx());
    expect(book.chapters.map(c => c.id)).toEqual(["chapter:001", "chapter:002", id]);
    const solo = knowledgeBook(); solo.chapters = [solo.chapters[0]!];
    expect(() => editStructure(solo, { op: "deleteChapter", chapterId: "chapter:001" }, ctx())).toThrow(/almeno un capitolo/);
  });
});

describe("Schede, eventi e timeline", () => {
  it("rinominare un personaggio sposta memoria e metadati delle scene, mai la prosa", () => {
    const book = knowledgeBook();
    scene(book, "scene:001:001").characters = ["Elena"];
    const edit = editEntity(book, "character:elena", { name: "Helena", attributes: { role: "Protagonista", personality: "Impulsiva", speech: "Frasi brevi, domande dirette" } }, ctx());
    expect(edit.changeKind).toBe("structural");
    expect(book.memory.characters.Helena).toBe("Investigatrice, cerca il fratello.");
    expect(book.memory.characters.Elena).toBeUndefined();
    expect(scene(book, "scene:001:001").characters).toEqual(["Helena"]);
    expect(scene(book, "scene:001:001").text).toContain("Elena ricorda");
    const entity = book.knowledge!.entities.find(e => e.id === "character:elena")!;
    expect(entity).toMatchObject({ version: 2, origin: "author", status: "validated" });
    expect(entity.history!.at(-1)!.snapshot.name).toBe("Elena");
    expect(() => editEntity(book, "character:markus", { name: "Helena" }, ctx())).toThrow(/Esiste già/);
    expect(editEntity(book, "character:markus", { attributes: { personality: "Ambiguo" } }, ctx()).changeKind).toBe("behavior");
  });
  it("crea, elimina e ripristina schede ripulendo relazioni, eventi e memoria", () => {
    const book = knowledgeBook();
    const created = addEntity(book, { type: "item", name: "La lettera", importance: "minor", summary: "Una lettera mai spedita." }, ctx());
    expect(created.target.id).toBe("item:la-lettera");
    expect(() => addEntity(book, { type: "item", name: "la lettera", importance: "minor", summary: "" }, ctx())).toThrow(/Esiste già/);
    const deleted = deleteEntity(book, "character:markus", ctx());
    const kb = book.knowledge!;
    expect(kb.entities.some(e => e.id === "character:markus")).toBe(false);
    expect(kb.entities.find(e => e.id === "character:elena")!.relationships.map(r => r.targetId)).not.toContain("character:markus");
    expect(kb.events.find(e => e.id === "event:incontro-con-l-informatore")!.perspectives.map(p => p.entityId)).toEqual(["character:elena"]);
    expect(book.memory.characters.Markus).toBeUndefined();
    restoreBefore(book, deleted.id, ctx());
    expect(book.knowledge!.entities.some(e => e.id === "character:markus")).toBe(true);
    expect(book.memory.characters.Markus).toBe("Informatore ambiguo.");
  });
  it("gli eventi validano scene, cause acicliche e ordine; eliminarli ripulisce le cause", () => {
    const book = knowledgeBook();
    expect(editEvent(book, "event:primo-indizio", { storyOrder: 4 }, ctx()).changeKind).toBe("structural");
    expect(editEvent(book, "event:primo-indizio", { summary: "Una firma strappata." }, ctx()).changeKind).toBe("event");
    expect(() => editEvent(book, "event:primo-indizio", { sceneIds: ["scene:999"] }, ctx())).toThrow(/scena inesistente/);
    expect(() => editEvent(book, "event:scomparsa-del-fratello", { causes: ["event:rivelazione-del-complotto"] }, ctx())).toThrow();
    expect(book.knowledge!.events.find(e => e.id === "event:scomparsa-del-fratello")!.causes).toEqual([]);
    moveEvent(book, "event:rivelazione-del-complotto", -1, ctx());
    const order = [...book.knowledge!.events].sort((a, b) => a.storyOrder - b.storyOrder).map(e => e.id);
    expect(order.indexOf("event:rivelazione-del-complotto")).toBeLessThan(order.indexOf("event:incontro-con-l-informatore"));
    const added = addEvent(book, { title: "La fuga", summary: "Elena scappa.", timelineId: "timeline:indagine-sulle-sparizioni" }, ctx());
    expect(book.knowledge!.events.find(e => e.id === added.target.id)!.timelineIds).toEqual(["timeline:indagine-sulle-sparizioni"]);
    deleteEvent(book, "event:primo-indizio", ctx());
    expect(book.knowledge!.events.find(e => e.id === "event:incontro-con-l-informatore")!.causes).toEqual([]);
  });
  it("timeline: crea, modifica, elimina e ripristina", () => {
    const book = knowledgeBook();
    const created = editTimeline(book, undefined, { title: "Passato di Markus", kind: "arc", summary: "Prima del romanzo." }, ctx());
    expect(created.target.id).toBe("timeline:passato-di-markus");
    editTimeline(book, created.target.id, { summary: "Gli anni nel Consiglio." }, ctx());
    const removed = deleteTimeline(book, "timeline:indagine-sulle-sparizioni", ctx());
    expect(book.knowledge!.events.every(e => !e.timelineIds.includes("timeline:indagine-sulle-sparizioni"))).toBe(true);
    restoreBefore(book, removed.id, ctx());
    expect(book.knowledge!.timelines.some(t => t.id === "timeline:indagine-sulle-sparizioni")).toBe(true);
  });
});

describe("Stato di review e storico", () => {
  it("una review vale solo per il contenuto esatto che ha letto", () => {
    const book = knowledgeBook();
    const target = { kind: "scene" as const, id: "scene:001:001" };
    editScene(book, target.id, { title: "La notte" }, ctx());
    expect(pendingElements(book).map(p => p.target.id)).toEqual([target.id]);
    setReviewState(book, [target], "review_passed");
    expect(elementReviewState(book, target)).toBe("review_passed");
    expect(pendingElements(book)).toEqual([]);
    // Changed by something that is not an author edit (e.g. the autopilot): no longer reviewed.
    scene(book, target.id).text += " Pioveva.";
    expect(elementReviewState(book, target)).toBe("modified_unreviewed");
    setReviewState(book, [target], "review_skipped");
    editScene(book, target.id, { title: "La notte della pioggia" }, ctx("2026-11-14T11:00:00.000Z"));
    const pending = pendingElements(book);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.edits).toHaveLength(1);
  });
  it("ripristina la versione precedente come nuova modifica, e tronca le copie vecchie quando lo storico cresce", () => {
    const book = knowledgeBook();
    const original = scene(book, "scene:002:001").text;
    const edit = editScene(book, "scene:002:001", { text: "Markus non viene all'appuntamento." }, ctx());
    const restored = restoreBefore(book, edit.id, ctx());
    expect(scene(book, "scene:002:001").text).toBe(original);
    expect(restored.prompt).toContain("Ripristino");
    expect(book.edits).toHaveLength(2);
    const big = "x".repeat(MAX_EDIT_SNAPSHOT_CHARS / 2);
    const pruned = pruneEdits([{ ...edit, before: big, after: big }, { ...edit, id: crypto.randomUUID(), before: big, after: "y" }]);
    expect(pruned[0]).toMatchObject({ before: null, after: null, pruned: true });
    expect(pruned[1]!.before).toBe(big);
    book.edits = pruned;
    expect(() => restoreBefore(book, pruned[0]!.id, ctx())).toThrow(/non è più conservata/);
    expect(currentStamp(book, { kind: "scene", id: "nessuna" })).toBe("deleted");
  });
});

describe("Memoria narrativa modificabile a mano", () => {
  it("stato corrente, cronologia e voci: aggiunta, modifica, eliminazione e ripristino, senza toccare la prosa", () => {
    const book = knowledgeBook();
    const prose = JSON.stringify(book.chapters);
    const state = editMemory(book, "state", "Elena sa che Markus lavora per il Consiglio.", ctx());
    expect(state).toMatchObject({ target: { kind: "memory", id: "state" }, label: "Stato corrente", reviewState: "modified_unreviewed" });
    expect(book.memory.currentState).toBe("Elena sa che Markus lavora per il Consiglio.");
    expect(() => editMemory(book, "state", "Elena sa che Markus lavora per il Consiglio.", ctx())).toThrow(/Nessuna modifica/);
    editMemory(book, "timeline", "Prima riga\n\n  Seconda riga ", ctx());
    expect(book.memory.timeline).toEqual(["Prima riga", "Seconda riga"]);
    const created = editMemory(book, "locations:Porto di Trieste", "Un molo battuto dal vento.", ctx());
    expect(created.field).toBe("creata");
    expect(memoryValue(book, "locations:Porto di Trieste")).toBe("Un molo battuto dal vento.");
    expect(memoryLabel("locations:Porto di Trieste")).toBe("Luoghi · Porto di Trieste");
    const removed = editMemory(book, "locations:Porto di Trieste", null, ctx());
    expect(removed.field).toBe("eliminata");
    expect(memoryValue(book, "locations:Porto di Trieste")).toBeUndefined();
    // Restoring a deleted entry brings it back; restoring an edit brings back the previous text.
    restoreBefore(book, removed.id, ctx());
    expect(memoryValue(book, "locations:Porto di Trieste")).toBe("Un molo battuto dal vento.");
    restoreBefore(book, state.id, ctx());
    expect(book.memory.currentState).not.toContain("Consiglio.");
    expect(JSON.stringify(book.chapters)).toBe(prose);
  });
  it("rifiuta parti inesistenti, nomi pericolosi, eliminazioni non ammesse", () => {
    const book = knowledgeBook();
    expect(parseMemoryId("nessuna:x")).toBeUndefined();
    expect(parseMemoryId("characters:Ana:Maria")).toEqual({ part: "entry", folder: "characters", name: "Ana:Maria" });
    expect(() => editMemory(book, "nessuna:x", "x", ctx())).toThrow(/non valida/);
    expect(() => editMemory(book, "characters:__proto__", "x", ctx())).toThrow(/Nome non valido/);
    expect(() => editMemory(book, "characters:Inesistente", null, ctx())).toThrow(/non trovata/);
    expect(() => editMemory(book, "state", null, ctx())).toThrow(/non si elimina/);
    expect(() => editMemory(book, "timeline", Array.from({ length: 401 }, (_, i) => "riga " + i).join("\n"), ctx())).toThrow(/massimo 400/);
  });
  it("una modifica propagata segue il suo percorso: in revisione, superata, oppure di nuovo da rivedere se annullata", () => {
    const book = knowledgeBook();
    const edit = editMemory(book, "state", "Elena sa che Markus mente.", ctx());
    const target = { kind: "memory" as const, id: "state" };
    const op = { id: crypto.randomUUID(), fromEdits: [edit.id], target } as Parameters<typeof followChangeEdits>[1];
    followChangeEdits(book, op, "started");
    expect(elementReviewState(book, target)).toBe("review_in_progress");
    followChangeEdits(book, op, "open");
    expect(elementReviewState(book, target)).toBe("modified_unreviewed");
    followChangeEdits(book, op, "started");
    followChangeEdits(book, op, "passed");
    expect(elementReviewState(book, target)).toBe("review_passed");
    // A newer edit the change never saw is not validated by it.
    const later = editMemory(book, "state", "Elena non sa più nulla.", ctx("2026-11-14T12:00:00.000Z"));
    followChangeEdits(book, op, "passed");
    expect(later.reviewState).toBe("modified_unreviewed");
    expect(elementReviewState(book, target)).toBe("modified_unreviewed");
  });
});
