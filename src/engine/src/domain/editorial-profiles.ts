import { z } from "zod";
import { readMarkdownDocument } from "./markdown-document";

export const BASE_READER_ROLES = ["readerGenre", "readerCasual", "readerSkeptic", "readerCharacters", "readerMystery"] as const;
export const EXTRA_READER_ROLES = ["readerExtra1", "readerExtra2", "readerExtra3", "readerExtra4", "readerExtra5"] as const;
export const READER_ROLES = [...BASE_READER_ROLES, ...EXTRA_READER_ROLES] as const;
export const SPECIALIST_ROLES = ["continuity", "secrets", "timeline", "historical", "characterVoice", "style", "narrative"] as const;
export const PROFILE_EDITORIAL_ROLES = [...SPECIALIST_ROLES, ...READER_ROLES, "writerReview"] as const;
export type ReaderRole = typeof READER_ROLES[number];
export const MAX_READER_PROFILES = 10;
export const MAX_WRITER_PROFILES = 6;
export const MAX_WRITER_RULES = 20;
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
const instructions = z.string().min(8).max(6000).refine(value => value.trim().length >= 8);
const version = z.number().int().min(1).max(100_000).optional();
/** A checklist item verified by the independent writer review. "mandatory" means
 * an unresolved violation can never be frozen silently: the author decides. */
export const writerRuleSchema = z.object({
  id, label: z.string().min(2).max(120).refine(value => value.trim().length >= 2),
  description: z.string().max(600), mandatory: z.boolean(),
}).strict();
export const readerProfileSchema = z.object({
  id, role: z.enum(READER_ROLES), name: z.string().min(1).max(80).refine(value => !!value.trim()),
  instructions, enabled: z.boolean(), version,
}).strict();
export const writerProfileSchema = z.object({
  id, name: z.string().min(1).max(80).refine(value => !!value.trim()), writingPrompt: instructions, reviewPrompt: instructions,
  strength: z.enum(["gentle", "balanced", "strict"]), reviewEnabled: z.boolean(),
  rules: z.array(writerRuleSchema).max(MAX_WRITER_RULES).optional(), version,
}).strict().superRefine((value, ctx) => {
  const ids = (value.rules ?? []).map(rule => rule.id);
  if (new Set(ids).size !== ids.length)
    ctx.addIssue({ code: "custom", message: "Regole dello scrittore duplicate." });
  if (!value.reviewEnabled && value.rules?.some(rule => rule.mandatory))
    ctx.addIssue({ code: "custom", message: "Una regola obbligatoria richiede la rilettura dello scrittore." });
});
/** Author guidance for the critical director. It is appended to, never replaces,
 * the fixed judge contract (evidence, sources, 1:1 decisions, freeze gates). */
export const directorProfileSchema = z.object({ instructions, version }).strict();
export const editorialProfilesSchema = z.object({
  schemaVersion: z.literal(1), readers: z.array(readerProfileSchema).min(1).max(MAX_READER_PROFILES),
  writers: z.array(writerProfileSchema).max(MAX_WRITER_PROFILES), selectedWriterId: id.optional(),
  director: directorProfileSchema.optional(),
  /** Rounds before the board stops for the author (default and maximum 3). */
  maxRounds: z.number().int().min(1).max(3).optional(),
}).strict().superRefine((value, ctx) => {
  const ids = [...value.readers, ...value.writers].map(p => p.id);
  if (new Set(ids).size !== ids.length || new Set(value.readers.map(p => p.role)).size !== value.readers.length ||
      !value.readers.some(p => p.enabled) || value.selectedWriterId && !value.writers.some(p => p.id === value.selectedWriterId))
    ctx.addIssue({ code: "custom", message: "Profili duplicati, nessun lettore attivo o scrittore selezionato assente." });
});
export type ReaderProfile = z.infer<typeof readerProfileSchema>;
export type WriterProfile = z.infer<typeof writerProfileSchema>;
export type WriterRule = z.infer<typeof writerRuleSchema>;
export type DirectorProfile = z.infer<typeof directorProfileSchema>;
export type EditorialProfiles = z.infer<typeof editorialProfilesSchema>;
export const profileSnapshotFields = {
  profileSettings: editorialProfilesSchema.optional(), profileMode: z.enum(["full", "light"]).optional(),
  roles: z.array(z.enum(PROFILE_EDITORIAL_ROLES)).min(1).max(18).refine(list => new Set(list).size === list.length).optional(),
};
export function refineProfileSnapshot(value: { profileSettings?: EditorialProfiles; profileMode?: "full" | "light"; roles?: readonly string[] }, ctx: z.RefinementCtx): void {
  const profiles = value.profileSettings;
  const roles = value.roles;
  if (!profiles) {
    if (value.profileMode || roles?.some(role => role === "writerReview" || (EXTRA_READER_ROLES as readonly string[]).includes(role)))
      ctx.addIssue({ code: "custom", message: "Profili del ciclo mancanti." });
    return;
  }
  const readers = profiles.readers.filter(p => p.enabled).map(p => p.role);
  const core = roles?.filter(role => !isReaderRole(role) && role !== "writerReview");
  const full = JSON.stringify(SPECIALIST_ROLES);
  const light = JSON.stringify(["continuity", "secrets", "timeline", "style"]);
  const lightHistorical = JSON.stringify(["continuity", "secrets", "timeline", "historical", "style"]);
  const validCore = value.profileMode === "full" ? JSON.stringify(core) === full :
    value.profileMode === "light" && [light, lightHistorical].includes(JSON.stringify(core));
  const expected = [...(core ?? []), ...readers, ...(selectedWriter(profiles)?.reviewEnabled ? ["writerReview"] : [])];
  if (!validCore || !roles || JSON.stringify(roles) !== JSON.stringify(expected))
    ctx.addIssue({ code: "custom", message: "Profili e revisori del ciclo non coerenti." });
}
export const profileSnapshotSchema = z.object({ ...profileSnapshotFields,
  reports: z.array(z.object({ reviewerName: z.string().max(120).optional(),
    profileStamp: z.string().regex(/^\d+:[a-f0-9]{8}$/).optional() }).passthrough()).max(720).optional(),
}).passthrough().superRefine(refineProfileSnapshot);

export function parseEditorialProfiles(value: unknown): EditorialProfiles {
  const parsed = editorialProfilesSchema.safeParse(value);
  if (!parsed.success) throw new Error("Profili editoriali non validi: verifica nomi, istruzioni, lettori attivi e selezione dello scrittore.");
  return parsed.data;
}
/** Explicit author-side preview only. Reading a repository NEVER calls this
 * to activate templates; the CMS loads a draft and requires a separate save. */
export function readEditorialProfileDocuments(files: Record<string, string>): EditorialProfiles {
  const readers: unknown[] = [], writers: unknown[] = [];
  let selectedWriterId: unknown, director: unknown, maxRounds: unknown;
  for (const [path, raw] of Object.entries(files)) {
    if (!/^profiles\/(?:(?:readers|writers|director)\/[a-zA-Z0-9][a-zA-Z0-9_.-]*|board)\.md$/.test(path)) continue;
    const { metadata: meta, body } = readMarkdownDocument(raw);
    if (meta.type === "reader_profile" && path.startsWith("profiles/readers/")) readers.push({
      id: meta.id, role: meta.role, name: meta.name, enabled: meta.enabled, instructions: body,
    });
    else if (meta.type === "writer_profile" && path.startsWith("profiles/writers/")) {
      writers.push({ id: meta.id, name: meta.name, writingPrompt: body, reviewPrompt: meta.review_prompt,
        strength: meta.strength, reviewEnabled: meta.review_enabled,
        ...(meta.rules === undefined ? {} : { rules: parseRuleLines(meta.rules) }) });
      if (meta.selected === true) {
        if (selectedWriterId !== undefined) throw new Error("Più scrittori selezionati nei template Markdown.");
        selectedWriterId = meta.id;
      }
    } else if (meta.type === "director_profile" && path.startsWith("profiles/director/")) {
      if (director !== undefined) throw new Error("Più direttori nei template Markdown.");
      director = { instructions: body };
    } else if (meta.type === "editorial_board" && path === "profiles/board.md") maxRounds = meta.max_rounds ?? undefined;
    if (readers.length > MAX_READER_PROFILES || writers.length > MAX_WRITER_PROFILES)
      throw new Error("Troppi profili nei template Markdown.");
  }
  if (!readers.length && !writers.length && director === undefined) throw new Error("Nessun template editoriale riconosciuto nei Markdown del libro.");
  return parseEditorialProfiles({ schemaVersion: 1, readers: readers.length ? readers : defaultEditorialProfiles().readers,
    writers, ...(selectedWriterId === undefined ? {} : { selectedWriterId }),
    ...(director === undefined ? {} : { director }), ...(maxRounds === undefined ? {} : { maxRounds }) });
}
/** «id | obbligatoria | etichetta | descrizione» — readable in a plain YAML list. */
export function formatRuleLine(rule: WriterRule): string {
  return [rule.id, rule.mandatory ? "obbligatoria" : "consultiva", rule.label, rule.description].join(" | ");
}
function parseRuleLines(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map(line => {
    const [ruleId, kind, label, ...description] = String(line).split(" | ");
    if (kind !== "obbligatoria" && kind !== "consultiva") return { invalid: line };
    return { id: ruleId, mandatory: kind === "obbligatoria", label, description: description.join(" | ") };
  });
}
export function defaultEditorialProfiles(): EditorialProfiles {
  const names = ["Lettore esperto del genere", "Lettore generalista", "Lettore critico e scettico", "Lettore delle relazioni", "Lettore di misteri e promesse"];
  const prompts = [
    "Leggi come esperto del genere: attese, originalità, tropi e tensione.",
    "Leggi da generalista: orientamento, chiarezza, coinvolgimento ed emozione.",
    "Metti in discussione coincidenze, forzature e lacune di logica.",
    "Giudica empatia, relazioni, credibilità delle voci e sottotesto.",
    "Giudica suspense e misteri come lettore che non conosce segreti o scalette future.",
  ];
  return { schemaVersion: 1, writers: [], readers: BASE_READER_ROLES.map((role, i) => ({
    id: role, role, name: names[i]!, instructions: prompts[i]!, enabled: true,
  })) };
}
export function isReaderRole(role: string): role is ReaderRole {
  return (READER_ROLES as readonly string[]).includes(role);
}
export function isStandardReader(role: string): boolean {
  return (BASE_READER_ROLES as readonly string[]).includes(role);
}
/** The five standard readers stay in every profile set: they can be edited or turned off, never removed.
 * Missing ones (older books, Markdown templates) come back turned off. */
export function withStandardReaders(profiles: EditorialProfiles): EditorialProfiles {
  const missing = defaultEditorialProfiles().readers.filter(d => !profiles.readers.some(p => p.role === d.role));
  if (!missing.length) return profiles;
  const ids = new Set([...profiles.readers, ...profiles.writers].map(p => p.id));
  return { ...profiles, readers: [...profiles.readers, ...missing.map(d => ({ ...d, id: ids.has(d.id) ? d.id + "-standard" : d.id, enabled: false }))] };
}
/** Plain-text view of a profile set, for the change history comparison. */
export function describeProfiles(profiles?: EditorialProfiles | null): string {
  if (!profiles) return "Workflow standard: cinque lettori, nessuna rilettura dello scrittore, direttore standard, massimo 3 cicli.";
  const writer = selectedWriter(profiles);
  return [
    "Scrittore in uso: " + (writer?.name ?? "standard (stile del libro)"),
    "Massimo cicli di revisione: " + maxEditorialRounds(profiles),
    ...profiles.readers.map(p => `Lettore «${p.name}»${p.enabled ? "" : " (disattivato)"}: ${p.instructions}`),
    ...profiles.writers.map(p => `Scrittore «${p.name}» (${STRENGTH_LABELS[p.strength]}${p.reviewEnabled ? ", con rilettura" : ""}): ${p.writingPrompt}` +
      (p.reviewEnabled ? `\n  Rilettura: ${p.reviewPrompt}` : "") +
      (p.rules ?? []).map(r => `\n  Regola ${r.mandatory ? "obbligatoria" : "consultiva"} «${r.label}»${r.description ? ": " + r.description : ""}`).join("")),
    "Direttore: " + (profiles.director?.instructions ?? "standard"),
  ].join("\n");
}
const STRENGTH_LABELS = { gentle: "flessibile", balanced: "bilanciato", strict: "vincolo forte" } as const;
export function selectedWriter(profiles?: EditorialProfiles): WriterProfile | undefined {
  return profiles?.writers.find(p => p.id === profiles.selectedWriterId);
}
const STRENGTH = {
  gentle: "Preferenza flessibile: segnala solo problemi sostanziali, senza imporre riscritture per gusto personale.",
  balanced: "Criterio prioritario: valuta il contesto e motiva le eccezioni utili alla narrazione.",
  strict: "Vincolo stilistico forte dell'autore: verifica con attenzione ogni violazione concreta; non inventare difetti né sacrificare chiarezza e continuità.",
} as const;
export function writerInstructions(profiles?: EditorialProfiles, review = false): string {
  const writer = selectedWriter(profiles === undefined ? undefined : parseEditorialProfiles(profiles));
  if (!writer) return "";
  const rules = writer.rules ?? [];
  return ["PROFILO DELLO SCRITTORE SCELTO DALL'AUTORE: " + writer.name,
    STRENGTH[writer.strength], "Criteri di scrittura:\n" + writer.writingPrompt,
    ...(rules.length ? ["Checklist delle regole narrative" + (review ? " da verificare una per una" : " da rispettare") + ":\n" +
      rules.map(rule => `- [${rule.mandatory ? "OBBLIGATORIA" : "consultiva"}] ${rule.id}: ${rule.label}${rule.description ? " — " + rule.description : ""}`).join("\n")] : []),
    ...(review ? ["Istruzioni per la rilettura indipendente:\n" + writer.reviewPrompt] : []),
    "Queste indicazioni non autorizzano nuovi fatti, spoiler, verifiche inventate o aggiramenti dei controlli editoriali.",
  ].join("\n");
}
/** Detects accidental template staleness, not an authentication signature. */
export function profileStamp(role: string, profiles?: EditorialProfiles): string | undefined {
  if (!profiles) return;
  if (role !== "writerReview" && !isReaderRole(role)) return;
  const safe = parseEditorialProfiles(profiles);
  const value = role === "writerReview" ? selectedWriter(safe) : safe.readers.find(p => p.role === role && p.enabled);
  if (!value) return;
  // The version counter is bookkeeping: the same instructions keep the same stamp.
  const { version: _version, ...content } = value;
  const text = JSON.stringify(content);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return text.length + ":" + (hash >>> 0).toString(16).padStart(8, "0");
}

export function writerRules(profiles?: EditorialProfiles): WriterRule[] {
  return selectedWriter(profiles === undefined ? undefined : parseEditorialProfiles(profiles))?.rules ?? [];
}
/** Starting rules for a «show, don't tell» writer. Editable; only the first is mandatory. */
export function defaultWriterRules(): WriterRule[] {
  return [
    { id: "show-dont-tell", label: "Applicare rigorosamente Show, Don't Tell", mandatory: true,
      description: "Evitare spiegazioni dirette di emozioni e stati interiori: mostrarli con gesti, azioni, dialoghi e dettagli." },
    { id: "character-voice", label: "Mantenere coerente la voce dei personaggi", mandatory: false,
      description: "Rispettare lessico, cultura e modo di parlare di ciascun personaggio." },
    { id: "no-redundancy", label: "Evitare ripetizioni e ridondanze", mandatory: false,
      description: "Controllare descrizioni, frasi e concetti ripetuti o informazioni inutili." },
    { id: "continuity", label: "Verificare la continuità narrativa", mandatory: false,
      description: "Confrontare fatti, eventi e dettagli con le schede e la memoria del libro." },
  ];
}
export function newWriterProfile(id: string): WriterProfile {
  return { id, name: "Scrittore mostra, non spiegare", strength: "balanced", reviewEnabled: true,
    writingPrompt: "Mostra attraverso azioni, gesti, dialoghi e dettagli concreti. Evita spiegazioni ridondanti e informazioni inutili; conserva ciò che serve a comprendere la scena. Non aggiungere fatti per giustificare ogni dettaglio.",
    reviewPrompt: "Rileggi come scrittore: individua spiegazioni superflue, emozioni dichiarate invece di mostrate e dettagli senza funzione. Cita il testo preciso, valuta il contesto e proponi solo correzioni necessarie. Non imporre il principio in modo cieco né eliminare informazioni indispensabili.",
    rules: defaultWriterRules() };
}
export const DEFAULT_DIRECTOR_INSTRUCTIONS =
  "Valuta la qualità complessiva del capitolo: coerenza con il canone, ritmo, voce e intenzione dell'autore. Accetta solo correzioni motivate e necessarie; respingi i rilievi di gusto personale.";
/** New books: standard readers plus a writer whose checklist is verified in every review.
 * The rules start advisory: blocking a chapter on a rule is the author's explicit choice. */
export function checklistEditorialProfiles(writerId: string): EditorialProfiles {
  const writer = newWriterProfile(writerId);
  return { ...defaultEditorialProfiles(), writers: [{ ...writer, rules: writer.rules?.map(rule => ({ ...rule, mandatory: false })) }], selectedWriterId: writerId };
}
export function directorInstructions(profiles?: EditorialProfiles): string {
  const director = profiles === undefined ? undefined : parseEditorialProfiles(profiles).director;
  if (!director) return "";
  return "LINEE GUIDA DEL DIRETTORE SCELTE DALL'AUTORE (si aggiungono alle regole sopra; non le sostituiscono e non autorizzano a saltare rilievi o controlli): " + director.instructions;
}
export function maxEditorialRounds(profiles?: EditorialProfiles): number {
  return profiles?.maxRounds ?? 3;
}

/** Assigned by the save use case: a new or changed agent gets the next version number. */
export function bumpProfileVersions(previous: EditorialProfiles | undefined, next: EditorialProfiles): EditorialProfiles {
  const result = structuredClone(next);
  // Key order must not count as a change: zod rebuilds objects in schema order.
  const stable = (value: unknown): string => Array.isArray(value) ? "[" + value.map(stable).join(",") + "]" :
    value && typeof value === "object" ? "{" + Object.keys(value).filter(k => k !== "version" && (value as Record<string, unknown>)[k] !== undefined).sort()
      .map(k => JSON.stringify(k) + ":" + stable((value as Record<string, unknown>)[k])).join(",") + "}" : JSON.stringify(value);
  const content = (value: object) => stable(value);
  function bump<T extends { version?: number }>(item: T, before: T | undefined): T {
    if (!before) return { ...item, version: 1 };
    return { ...item, version: content(before) === content(item) ? before.version ?? 1 : (before.version ?? 1) + 1 };
  }
  result.readers = result.readers.map(item => bump(item, previous?.readers.find(p => p.id === item.id)));
  result.writers = result.writers.map(item => bump(item, previous?.writers.find(p => p.id === item.id)));
  if (result.director) result.director = bump(result.director, previous?.director);
  return result;
}
