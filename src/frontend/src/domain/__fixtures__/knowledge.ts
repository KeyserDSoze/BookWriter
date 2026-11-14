import { newBook, type BookProject } from "../types";
import { mergeKnowledgeReply, emptyKnowledge } from "../knowledge";

/** Synthetic two-chapter mystery with sheets, events and a flashback. */
export function knowledgeBook(): BookProject {
  const book = newBook("Un'investigatrice cerca il fratello scomparso.", "Le sparizioni", "Asciutto", "Adulti");
  book.phase = "prose"; book.status = "paused";
  const frozenAt = "2026-11-10T10:00:00.000Z";
  book.chapters = [
    { id: "chapter:001", number: 1, title: "L'archivio", purpose: "Elena trova il primo indizio.", frozenAt, summary: "Elena entra nell'archivio.",
      bookSummaryAtFreeze: "Elena cerca il fratello e trova un indizio.", scenes: [
        { id: "scene:001:001", number: 1, title: "Il ricordo", objective: "Mostrare la scomparsa", status: "canon",
          text: "Elena ricorda la notte in cui il fratello non tornò. Aveva dodici anni.", summary: "Elena ricorda la scomparsa del fratello." },
        { id: "scene:001:002", number: 2, title: "Il registro", objective: "Il primo indizio", status: "canon",
          text: "Nell'archivio municipale Elena sfoglia il registro e trova una firma cancellata.", summary: "Elena trova una firma cancellata." },
      ] },
    { id: "chapter:002", number: 2, title: "L'informatore", purpose: "Un alleato ambiguo.", frozenAt, summary: "Markus parla.",
      bookSummaryAtFreeze: "Elena incontra Markus, che sa del Consiglio.", scenes: [
        { id: "scene:002:001", number: 1, title: "Il molo", objective: "Incontrare l'informatore", status: "canon",
          text: "Markus aspetta sul molo. Dice di conoscere il Consiglio cittadino.", summary: "Markus si presenta." },
        { id: "scene:002:002", number: 2, title: "La prova", objective: "La rivelazione", status: "canon",
          text: "Elena capisce che la firma era del Consiglio cittadino. Non dice nulla a Markus.", summary: "Elena collega la firma al Consiglio." },
      ] },
  ];
  book.bookSummary = "Elena incontra Markus, che sa del Consiglio.";
  book.memory.characters = { Elena: "Investigatrice, cerca il fratello.", Markus: "Informatore ambiguo." };
  book.memory.locations = { "Archivio municipale": "Custodisce i registri." };
  const now = "2026-11-10T09:00:00.000Z";
  book.knowledge = mergeKnowledgeReply(emptyKnowledge(), {
    timelines: [{ title: "Indagine sulle sparizioni", kind: "arc", summary: "L'indagine di Elena." }],
    entities: [
      { type: "character", name: "Elena", aliases: ["Elena Voss"], importance: "main", summary: "Investigatrice protagonista.",
        attributes: { role: "Protagonista", personality: "Razionale e diffidente", speech: "Frasi brevi, domande dirette" },
        relationships: [{ target: "Markus", type: "alleato" }, { target: "Consiglio cittadino", type: "antagonista" }] },
      { type: "character", name: "Markus", importance: "secondary", summary: "Informatore." },
      { type: "faction", name: "Consiglio cittadino", importance: "main", summary: "Governa la città e nasconde le sparizioni." },
      { type: "location", name: "Archivio municipale", importance: "secondary", summary: "Dove si trovano i registri." },
    ],
    events: [
      { title: "Scomparsa del fratello", summary: "Il fratello di Elena sparisce.", storyOrder: 1, narration: "flashback",
        involves: ["Elena"], sceneIds: ["scene:001:001"], timelines: ["Indagine sulle sparizioni"] },
      { title: "Primo indizio", summary: "Una firma cancellata nel registro.", storyOrder: 3, involves: ["Elena", "Archivio municipale"],
        causes: ["Scomparsa del fratello"], sceneIds: ["scene:001:002"], timelines: ["Indagine sulle sparizioni"] },
      { title: "Incontro con l'informatore", summary: "Markus si offre di aiutare.", storyOrder: 5, involves: ["Markus", "Elena"],
        causes: ["Primo indizio"], sceneIds: ["scene:002:001"],
        perspectives: [{ who: "Markus", stance: "conceals", note: "Lavora per il Consiglio" }, { who: "Elena", stance: "unaware" }] },
      { title: "Rivelazione del complotto", summary: "La firma porta al Consiglio.", storyOrder: 9, involves: ["Elena", "Consiglio cittadino"],
        causes: ["Incontro con l'informatore"], sceneIds: ["scene:002:002"], secret: true },
    ],
  }, { origin: "planned", reason: "fixture", now });
  return book;
}
