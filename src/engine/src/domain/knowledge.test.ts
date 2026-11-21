import { describe, expect, it } from "vitest";
import { knowledgeBook } from "./__fixtures__/knowledge";
import { describeEntities, describeEvents, emptyKnowledge, knowledgeBaseSchema, mergeKnowledgeReply, mergeKnowledgeWithMemory, parseKnowledge,
  syncKnowledgeWithMemory } from "./knowledge";
import { analyzeImpact, dependentEvents, entityReferences, entityState, eventState, relevantKnowledge, timelineOrders } from "./knowledge-index";

const now = "2026-11-14T12:00:00.000Z";

describe("Knowledge base narrativa", () => {
  it("crea schede con ID stabili, relazioni per ID, eventi con cause, prospettive e timeline", () => {
    const kb = knowledgeBook().knowledge!;
    const elena = kb.entities.find(e => e.name === "Elena")!;
    expect(elena.id).toBe("character:elena");
    expect(elena.relationships).toEqual([{ targetId: "character:markus", type: "alleato" }, { targetId: "faction:consiglio-cittadino", type: "antagonista" }]);
    const meeting = kb.events.find(e => e.title === "Incontro con l'informatore")!;
    expect(meeting.causes).toEqual(["event:primo-indizio"]);
    expect(meeting.perspectives).toContainEqual({ entityId: "character:markus", stance: "conceals", note: "Lavora per il Consiglio" });
    expect(kb.events.find(e => e.title === "Scomparsa del fratello")!.timelineIds).toEqual(["timeline:indagine-sulle-sparizioni"]);
    expect(knowledgeBaseSchema.safeParse(kb).success).toBe(true);
  });
  it("un aggiornamento conserva ID e storia, incrementa la versione solo se qualcosa cambia", () => {
    const kb = knowledgeBook().knowledge!;
    const same = mergeKnowledgeReply(kb, { entities: [{ type: "character", name: "Elena Voss" }] }, { origin: "written", reason: "r", now });
    expect(same.entities.find(e => e.id === "character:elena")!.version).toBe(1);
    const changed = mergeKnowledgeReply(kb, { entities: [{ type: "character", name: "Elena", attributes: { personality: "Impulsiva" } }] },
      { origin: "written", reason: "Scena 3", now });
    const elena = changed.entities.find(e => e.id === "character:elena")!;
    expect(elena.version).toBe(2);
    expect(elena.attributes.personality).toBe("Impulsiva");
    expect(elena.attributes.speech).toBe("Frasi brevi, domande dirette");
    expect(elena.history![0]).toMatchObject({ version: 1, reason: "Scena 3" });
    expect(elena.history![0]!.snapshot.attributes.personality).toBe("Razionale e diffidente");
  });
  it("rifiuta nomi sconosciuti, scene inventate, cicli causali e duplicati, senza applicare nulla", () => {
    const kb = knowledgeBook().knowledge!;
    const opts = { origin: "written" as const, reason: "r", now, sceneIds: new Set(["scene:001:001"]) };
    expect(() => mergeKnowledgeReply(kb, { events: [{ title: "Nuovo", involves: ["Sconosciuto"] }] }, opts)).toThrow(/Sconosciuto/);
    expect(() => mergeKnowledgeReply(kb, { events: [{ title: "Nuovo", sceneIds: ["scene:009:009"] }] }, opts)).toThrow(/scena inesistente/);
    expect(() => mergeKnowledgeReply(kb, { events: [{ title: "Scomparsa del fratello", causes: ["Rivelazione del complotto"] }] }, opts)).toThrow(/ciclo/);
    expect(() => mergeKnowledgeReply(kb, { entities: [{ type: "character", name: "Mara", relationships: [{ target: "Nessuno", type: "amica" }] }] }, opts)).toThrow(/Nessuno/);
    const dup = structuredClone(kb); dup.entities[1]!.aliases = ["Elena"];
    expect(() => parseKnowledge(dup)).toThrow(/stesso nome/);
    expect(() => parseKnowledge({ ...kb, entities: [{ ...kb.entities[0]!, attributes: { "__proto__": "x" } }] })).toThrow();
    expect(() => parseKnowledge({ ...kb, extra: true })).toThrow();
  });
  it("le voci di memoria senza scheda diventano bozze, senza AI", () => {
    const kb = syncKnowledgeWithMemory(emptyKnowledge(), { characters: { Ada: "Una testimone." }, locations: {}, items: { Chiave: "Apre il registro." }, factions: {} }, now);
    expect(kb.entities.map(e => [e.id, e.status, e.origin])).toEqual([["character:ada", "draft", "written"], ["item:chiave", "draft", "written"]]);
    expect(syncKnowledgeWithMemory(kb, { characters: { Ada: "x" }, locations: {}, items: {}, factions: {} }, now).entities).toHaveLength(2);
  });
  it("una voce di memoria che la risposta definisce come alias diventa quella scheda, non una seconda", () => {
    const memory = { characters: { Mara: "La protagonista.", Lena: "Una pescatrice." }, locations: {}, items: {}, factions: {} };
    const reply = { entities: [{ type: "character", name: "Mara Venturi", aliases: ["Mara"], summary: "Cerca il padre." }],
      events: [{ title: "Mara incontra Lena", involves: ["Mara", "Lena"] }] };
    const kb = mergeKnowledgeWithMemory(emptyKnowledge(), memory, reply, { origin: "written", reason: "r", now });
    const characters = kb.entities.filter(e => e.type === "character");
    expect(characters.map(e => e.name).sort()).toEqual(["Lena", "Mara Venturi"]);
    const mara = characters.find(e => e.name === "Mara Venturi")!;
    expect(mara.aliases).toEqual(["Mara"]);
    expect(kb.events[0]!.involves).toEqual([mara.id, characters.find(e => e.name === "Lena")!.id]);
    // Without a reply it is the plain memory sync.
    expect(mergeKnowledgeWithMemory(emptyKnowledge(), memory, undefined, { origin: "written", reason: "r", now }).entities
      .map(e => e.name)).toEqual(["Mara", "Lena"]);
    // A collision with a sheet that already exists is still the model's error, said with the names.
    const existing = syncKnowledgeWithMemory(emptyKnowledge(), memory, now);
    expect(() => mergeKnowledgeWithMemory(existing, memory, reply, { origin: "written", reason: "r", now }))
      .toThrow(/«Mara» di «Mara Venturi»/);
  });
  it("alias ripetuti o uguali al nome della scheda non sono un errore; una collisione con un'altra scheda dice quale", () => {
    const kb = knowledgeBook().knowledge!;
    const merged = mergeKnowledgeReply(kb, { entities: [{ type: "character", name: "Elena", aliases: ["elena", "La detective", "la detective "] }] },
      { origin: "written", reason: "r", now });
    expect(merged.entities.find(e => e.id === "character:elena")!.aliases).toContain("La detective");
    expect(merged.entities.find(e => e.id === "character:elena")!.aliases.filter(a => a.toLowerCase().trim() === "la detective")).toHaveLength(1);
    expect(merged.entities.find(e => e.id === "character:elena")!.aliases.map(a => a.toLowerCase())).not.toContain("elena");
    expect(() => mergeKnowledgeReply(kb, { entities: [{ type: "character", name: "Elena", aliases: ["Markus"] }] },
      { origin: "written", reason: "r", now })).toThrow(/«Markus» di «Elena»/);
  });
  it("un evento con lo stesso titolo a meno di punteggiatura e maiuscole è lo stesso evento", () => {
    const kb = knowledgeBook().knowledge!;
    const before = kb.events.length;
    const merged = mergeKnowledgeReply(kb, { events: [{ title: "incontro con l'informatore!", summary: "Elena incontra Markus al porto." }] },
      { origin: "written", reason: "r", now });
    expect(merged.events).toHaveLength(before);
    expect(merged.events.find(e => e.title === "Incontro con l'informatore")!.summary).toBe("Elena incontra Markus al porto.");
  });
  it("una scheda bozza che rispecchia ancora la memoria la segue; una scheda toccata dall'autore no", () => {
    const empty = { characters: {}, locations: {}, items: {}, factions: {} };
    const before = { ...empty, characters: { Ada: "Una testimone.", Bruno: "Il cocchiere." } };
    let kb = syncKnowledgeWithMemory(emptyKnowledge(), before, now);
    kb.entities.find(e => e.name === "Bruno")!.summary = "Il cocchiere, scritto dall'autore.";
    const after = { ...empty, characters: { Ada: "Una testimone che ha visto il furto.", Bruno: "Il cocchiere, ora ferito." } };
    kb = syncKnowledgeWithMemory(kb, after, "2026-11-15T12:00:00.000Z", before);
    const ada = kb.entities.find(e => e.name === "Ada")!, bruno = kb.entities.find(e => e.name === "Bruno")!;
    expect(ada).toMatchObject({ summary: "Una testimone che ha visto il furto.", version: 2 });
    expect(ada.history![0]!.snapshot.summary).toBe("Una testimone.");
    expect(bruno).toMatchObject({ summary: "Il cocchiere, scritto dall'autore.", version: 1 });
    // Without the previous memory nothing existing is touched.
    expect(syncKnowledgeWithMemory(kb, { ...empty, characters: { Ada: "Altro." } }, now).entities.find(e => e.name === "Ada")!.version).toBe(2);
  });
  it("un cambio delle sole relazioni \u00e8 una nuova versione, e la versione precedente non cambia dopo", () => {
    const kb = knowledgeBook().knowledge!;
    const merged = mergeKnowledgeReply(kb, { entities: [{ type: "character", name: "Elena", relationships: [{ target: "Markus", type: "nemico" }] }] },
      { origin: "written", reason: "Tradimento", now });
    const elena = merged.entities.find(e => e.id === "character:elena")!;
    expect(elena.version).toBe(2);
    expect(elena.relationships.find(r => r.targetId === "character:markus")!.type).toBe("nemico");
    expect(elena.history![0]!.snapshot.relationships.find(r => r.targetId === "character:markus")!.type).toBe("alleato");
    const both = mergeKnowledgeReply(kb, { entities: [{ type: "character", name: "Elena", summary: "Tradita.", relationships: [{ target: "Markus", type: "nemico" }] }] },
      { origin: "written", reason: "Tradimento", now });
    const once = both.entities.find(e => e.id === "character:elena")!;
    expect(once.version).toBe(2);
    expect(once.history![0]!.snapshot.relationships.find(r => r.targetId === "character:markus")!.type).toBe("alleato");
  });
  it("le descrizioni per i prompt sono compatte e includono prospettive e segreti", () => {
    const kb = knowledgeBook().knowledge!;
    expect(describeEntities(kb.entities.slice(0, 1), kb)).toContain("Modo di parlare: Frasi brevi");
    expect(describeEntities(kb.entities.slice(0, 1), kb)).toContain("alleato Markus");
    const events = describeEvents(kb.events, kb);
    expect(events).toContain("[Flashback] Scomparsa del fratello");
    expect(events).toContain("Markus sa e nasconde (Lavora per il Consiglio)");
    expect(events).toContain("SEGRETO");
  });
});

describe("Indice delle dipendenze (ricostruito dai dati)", () => {
  it("presenze per metadati, parola intera ed eventi; stato pianificato, scritto, consolidato", () => {
    const book = knowledgeBook(), kb = book.knowledge!;
    const elena = kb.entities.find(e => e.name === "Elena")!;
    expect(entityReferences(book, kb, elena).map(r => r.sceneId)).toEqual(["scene:001:001", "scene:001:002", "scene:002:001", "scene:002:002"]);
    expect(entityReferences(book, kb, elena).find(r => r.sceneId === "scene:002:001")!.via).toBe("event");
    expect(entityState(book, entityReferences(book, kb, elena))).toBe("consolidated");
    book.chapters[1]!.frozenAt = undefined;
    const markus = kb.entities.find(e => e.name === "Markus")!;
    expect(entityState(book, entityReferences(book, kb, markus))).toBe("narrated");
    book.chapters[1]!.scenes[0]!.status = "planned"; book.chapters[1]!.scenes[1]!.text = "Nessuno parla.";
    expect(entityState(book, entityReferences(book, kb, markus))).toBe("planned");
  });
  it("non confonde un nome con una parola che lo contiene", () => {
    const book = knowledgeBook(), kb = mergeKnowledgeReply(book.knowledge!, { entities: [{ type: "character", name: "Ivo" }] }, { origin: "written", reason: "r", now });
    book.chapters[0]!.scenes[0]!.text = "Era vivo per miracolo.";
    expect(entityReferences(book, kb, kb.entities.find(e => e.name === "Ivo")!)).toEqual([]);
  });
  it("eventi dipendenti, impatto diretto/indiretto/globale e due ordini di timeline", () => {
    const book = knowledgeBook(), kb = book.knowledge!;
    expect(dependentEvents(kb, "event:scomparsa-del-fratello").map(e => e.id))
      .toEqual(["event:primo-indizio", "event:incontro-con-l-informatore", "event:rivelazione-del-complotto"]);
    const markus = analyzeImpact(book, kb, { kind: "entity", id: "character:markus" });
    expect(markus.direct).toEqual(["scene:002:001", "scene:002:002"]);
    expect(markus.indirect).toEqual([]);
    const event = analyzeImpact(book, kb, { kind: "event", id: "event:primo-indizio" });
    expect(event.direct).toEqual(["scene:001:002"]);
    expect(event.indirect).toEqual(["scene:002:001", "scene:002:002"]);
    expect(analyzeImpact(book, kb, { kind: "entity", id: "character:elena" }).global).toBe(true);
    book.chapters[0]!.scenes[1]!.number = 1; book.chapters[0]!.scenes[0]!.number = 2; // the flashback is now told second
    const orders = timelineOrders(book, kb);
    expect(orders.story[0]!.title).toBe("Scomparsa del fratello");
    expect(orders.narration[0]!.title).toBe("Primo indizio");
    expect(timelineOrders(book, kb, "timeline:indagine-sulle-sparizioni").story).toHaveLength(2);
    expect(eventState(book, kb.events[0]!)).toBe("consolidated");
  });
  it("schede ed eventi pertinenti a un testo, ordinati per importanza", () => {
    const book = knowledgeBook(), kb = book.knowledge!;
    const found = relevantKnowledge(book, kb, "Markus guarda il molo.", "scene:002:001", 2);
    expect(found.entities.map(e => e.name)).toEqual(["Elena", "Markus"]);
    expect(found.events.map(e => e.title)).toEqual(["Incontro con l'informatore"]);
  });
});
