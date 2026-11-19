import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, newBook, type AppSettings, type BookProject } from "./types";
import {
  cloudSettingsSignature, hasForbiddenKey, isDefaultLocalSettings, libraryView, mergeLibrary,
  parseCloudLibrary, parseCloudProfile, projectSettings, removeLibraryEntry, summarizeBook,
  type CloudLibrary, type CloudProfile, type LibraryEntry,
} from "./cloud-profile";

const DEVICE_A = { id: "11111111-1111-4111-8111-111111111111", name: "PC Studio" };
const DEVICE_B = { id: "22222222-2222-4222-8222-222222222222", name: "Portatile" };
const T1 = "2026-11-10T10:00:00.000Z", T2 = "2026-11-11T10:00:00.000Z", T3 = "2026-11-12T10:00:00.000Z";
const SHA = "a".repeat(40), SHA2 = "b".repeat(40);
const BOOK_ID = "44444444-4444-4444-8444-444444444444";

function settings(): AppSettings {
  const base = structuredClone(DEFAULT_SETTINGS);
  base.theme = "light";
  base.inspectAiRequests = true;
  base.keepAiConversations = true;
  base.syncAiConversationsToGitHub = true;
  base.aiTraceRetention = { maxTasks: 50, maxMinutes: 30 };
  base.githubToken = { iv: "iv-github", data: "data-github" };
  base.endpoints = [{
    id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1",
    secret: { iv: "iv-1", data: "data-1" }, models: ["gpt-x"], streamMode: "sse",
    modelReasoning: { "gpt-x": { options: ["low"] } },
  }];
  base.defaultRoute = { endpointId: "openai", modelId: "gpt-x" };
  return base;
}
function book(updatedAt = T1, remote = true): BookProject {
  const created = newBook("BRIEF SEGRETO DEL ROMANZO", "Il faro", "Sobrio", "Adulti");
  created.id = BOOK_ID;
  created.updatedAt = updatedAt;
  created.memory.secrets = { Mara: "SEGRETO NARRATIVO" };
  created.chapters = [{ id: "c1", number: 1, title: "Uno", purpose: "p", frozenAt: T1, scenes: [
    { id: "s1", number: 1, title: "S", objective: "o", text: "TESTO RISERVATO DELLA SCENA", status: "canon" }] }];
  if (remote) created.remote = { owner: "demo", repository: "faro", branch: "main",
    lastSyncedCommit: SHA, lastSyncAt: T1, autoSync: true };
  return created;
}

describe("proiezione delle impostazioni sul cloud", () => {
  it("non contiene segreti, tema, consenso all'ispezione né cataloghi letti dal provider", () => {
    const text = JSON.stringify(projectSettings(settings()));
    for (const forbidden of ["iv-1", "data-1", "iv-github", "secret", "githubToken", "theme", "inspectAiRequests", "modelReasoning",
      "keepAiConversations", "syncAiConversationsToGitHub", "aiTraceRetention", "maxTasks"])
      expect(text).not.toContain(forbidden);
    expect(projectSettings(settings()).endpoints[0]).toMatchObject({ id: "openai", streamMode: "sse", models: ["gpt-x"] });
  });
  it("la firma cambia quando cambia un segreto o una impostazione, non per tema o consenso", () => {
    const base = settings();
    const same = { ...structuredClone(base), theme: "dark" as const, inspectAiRequests: false,
      keepAiConversations: false, syncAiConversationsToGitHub: false, aiTraceRetention: { maxTasks: 5, maxMinutes: 60 } };
    expect(cloudSettingsSignature(same)).toBe(cloudSettingsSignature(base));
    const rekeyed = structuredClone(base);
    rekeyed.endpoints[0]!.secret = { iv: "iv-2", data: "data-2" };
    expect(cloudSettingsSignature(rekeyed)).not.toBe(cloudSettingsSignature(base));
    const retoken = { ...structuredClone(base), githubToken: { iv: "x", data: "y" } };
    expect(cloudSettingsSignature(retoken)).not.toBe(cloudSettingsSignature(base));
    const reroute = { ...structuredClone(base), defaultRoute: { endpointId: "openai", modelId: "altro" } };
    expect(cloudSettingsSignature(reroute)).not.toBe(cloudSettingsSignature(base));
  });
  it("la firma non contiene mai testo in chiaro dei segreti", () => {
    expect(cloudSettingsSignature(settings())).not.toMatch(/sk-|github_pat/);
  });
  it("riconosce le impostazioni ancora di fabbrica", () => {
    expect(isDefaultLocalSettings(structuredClone(DEFAULT_SETTINGS), DEFAULT_SETTINGS)).toBe(true);
    expect(isDefaultLocalSettings(settings(), DEFAULT_SETTINGS)).toBe(false);
  });
});

describe("file del profilo cloud come input ostile", () => {
  const valid = (): CloudProfile => ({
    schemaVersion: 1, kind: "profile", revision: 3, updatedAt: T1,
    deviceId: DEVICE_A.id, deviceName: DEVICE_A.name, settings: projectSettings(settings()), vault: null,
  });
  it("accetta un profilo valido", () => {
    expect(parseCloudProfile(JSON.stringify(valid())).ok).toBe(true);
  });
  it.each([
    ["campo extra", (p: Record<string, unknown>) => { p.extra = 1; }],
    ["versione sconosciuta", (p: Record<string, unknown>) => { p.schemaVersion = 2; }],
    ["revisione negativa", (p: Record<string, unknown>) => { p.revision = -1; }],
    ["device non uuid", (p: Record<string, unknown>) => { p.deviceId = "pc"; }],
    ["segreto accanto alle impostazioni", (p: Record<string, unknown>) => {
      (p.settings as { endpoints: Array<Record<string, unknown>> }).endpoints[0]!.secret = { iv: "a", data: "b" }; }],
    ["task sconosciuto", (p: Record<string, unknown>) => {
      (p.settings as { taskRoutes: Record<string, unknown> }).taskRoutes.hack = { endpointId: "a", modelId: "b" }; }],
    ["iterazioni PBKDF2 enormi", (p: Record<string, unknown>) => { p.vault = { mode: "passphrase", version: 1,
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 999_999_999, salt: "AAAAAAAAAAAAAAAAAAAAAA==" }, iv: "AAAAAAAAAAAAAAAA", data: "AAAA" }; }],
    ["tariffa negativa", (p: Record<string, unknown>) => {
      (p.settings as Record<string, unknown>).aiPriceRates = [{ endpointId: "a", modelId: "b", inputEurPerMillion: -1, outputEurPerMillion: 1 }]; }],
  ])("rifiuta: %s", (_label, mutate) => {
    const profile = valid() as unknown as Record<string, unknown>;
    mutate(profile);
    expect(parseCloudProfile(JSON.stringify(profile)).ok).toBe(false);
  });
  it("rifiuta chiavi di prototype pollution ovunque nell'albero", () => {
    const text = JSON.stringify(valid()).replace('"models":["gpt-x"]', '"models":["gpt-x"],"__proto__":{"x":1}');
    expect(text).toContain("__proto__");
    expect(parseCloudProfile(text).ok).toBe(false);
    expect(hasForbiddenKey(JSON.parse('{"a":[{"constructor":1}]}'))).toBe(true);
    expect(hasForbiddenKey({ a: { b: 1 } })).toBe(false);
  });
  it("rifiuta JSON non valido e file oltre 1 MiB senza eccezioni", () => {
    expect(parseCloudProfile("{non json").ok).toBe(false);
    expect(parseCloudProfile(" ".repeat(1_048_577)).ok).toBe(false);
  });
  it("il messaggio d'errore non riporta il contenuto del file", () => {
    const result = parseCloudProfile('{"schemaVersion":1,"secret":"sk-live-123"}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toContain("sk-live-123");
  });
});

describe("indice dei libri", () => {
  it("riassume solo stato e coordinate: mai brief, memoria, segreti o prosa", () => {
    const entry = summarizeBook(book(), DEVICE_A, T2);
    const text = JSON.stringify(entry);
    for (const forbidden of ["BRIEF SEGRETO", "SEGRETO NARRATIVO", "TESTO RISERVATO"]) expect(text).not.toContain(forbidden);
    expect(entry).toMatchObject({ title: "Il faro", progress: { chapters: 1, scenes: 1, canonScenes: 1, frozenChapters: 1 },
      remote: { owner: "demo", repository: "faro", branch: "main" }, lastSyncedCommit: SHA, deviceId: DEVICE_A.id });
    expect(entry).not.toHaveProperty("remote.autoSync");
  });
  const library = (...entries: LibraryEntry[]): CloudLibrary => ({
    schemaVersion: 1, kind: "library", revision: 4, updatedAt: T1, books: entries });

  it("la prima scrittura crea l'indice alla revisione 1", () => {
    const merge = mergeLibrary(null, [summarizeBook(book(), DEVICE_A, T2)], T2);
    expect(merge.library.revision).toBe(1);
    expect(merge.changedBookIds).toHaveLength(1);
  });
  it("non riscrive nulla se lo stato non è cambiato, anche con data o dispositivo diversi", () => {
    const b = book();
    const remote = library(summarizeBook(b, DEVICE_B, T1));
    const merge = mergeLibrary(remote, [summarizeBook(b, DEVICE_A, T3)], T3);
    expect(merge.changedBookIds).toEqual([]);
    expect(merge.library.revision).toBe(4);
  });
  it("un dispositivo indietro non fa regredire un libro che un altro ha già avanzato", () => {
    const newer = summarizeBook(book(T3), DEVICE_B, T3);
    const merge = mergeLibrary(library(newer), [summarizeBook(book(T1), DEVICE_A, T2)], T2);
    expect(merge.changedBookIds).toEqual([]);
    expect(merge.library.books[0]!.bookUpdatedAt).toBe(T3);
  });
  it("conserva i libri che questo dispositivo non possiede e aggiorna i propri", () => {
    const other = { ...summarizeBook(book(T1), DEVICE_B, T1), bookId: "33333333-3333-4333-8333-333333333333" };
    const mine = book(T3);
    const merge = mergeLibrary(library(other, summarizeBook(book(T1), DEVICE_B, T1)), [summarizeBook(mine, DEVICE_A, T3)], T3);
    expect(merge.library.books.map(entry => entry.bookId)).toContain(other.bookId);
    expect(merge.changedBookIds).toEqual([mine.id]);
  });
  it("a parità di revisione prevale chi ha sincronizzato per ultimo (nuovo commit)", () => {
    const b = book(T1);
    const remote = library(summarizeBook(b, DEVICE_B, T1));
    const synced = { ...b, remote: { ...b.remote!, lastSyncedCommit: SHA2, lastSyncAt: T3 } };
    const merge = mergeLibrary(remote, [summarizeBook(synced, DEVICE_A, T3)], T3);
    expect(merge.library.books[0]!.lastSyncedCommit).toBe(SHA2);
  });
  it("rifiuta più di 200 libri invece di troncare in silenzio", () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ ...summarizeBook(book(), DEVICE_A, T1),
      bookId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` }));
    expect(() => mergeLibrary(null, many, T1)).toThrow(/200 libri/);
  });
  it("una rimozione esplicita vince finché il libro non cambia dopo", () => {
    const b = book(T1);
    const removed = removeLibraryEntry(library(summarizeBook(b, DEVICE_A, T1)), b.id, DEVICE_B, T2);
    expect(removed.books[0]!.removed).toBe(true);
    expect(libraryView(removed, [], DEVICE_A.id)).toEqual([]);
    expect(mergeLibrary(removed, [summarizeBook(book(T3), DEVICE_A, T3)], T3).changedBookIds).toEqual([b.id]);
    expect(mergeLibrary(removed, [summarizeBook(book(T1), DEVICE_A, T3)], T3).changedBookIds).toEqual([]);
  });
  it("schema: duplicati, campi extra e date non valide sono rifiutati", () => {
    const entry = summarizeBook(book(), DEVICE_A, T1);
    expect(parseCloudLibrary(JSON.stringify(library(entry, entry))).ok).toBe(false);
    expect(parseCloudLibrary(JSON.stringify(library({ ...entry, brief: "x" } as LibraryEntry))).ok).toBe(false);
    expect(parseCloudLibrary(JSON.stringify(library({ ...entry, bookUpdatedAt: "ieri" }))).ok).toBe(false);
    expect(parseCloudLibrary(JSON.stringify(library(entry))).ok).toBe(true);
  });
});

describe("vista della libreria cloud su questo dispositivo", () => {
  const entryFor = (b: BookProject, device = DEVICE_B, at = T1) => summarizeBook(b, device, at);
  const lib = (...entries: LibraryEntry[]): CloudLibrary => ({ schemaVersion: 1, kind: "library", revision: 1, updatedAt: T1, books: entries });

  it("libro presente solo nel cloud: scaricabile se ha una repository", () => {
    const remoteBook = book(T2);
    expect(libraryView(lib(entryFor(remoteBook)), [], DEVICE_A.id)[0]!.kind).toBe("cloud_only");
    const noRepo = book(T2, false);
    expect(libraryView(lib(entryFor(noRepo)), [], DEVICE_A.id)[0]!.kind).toBe("no_repository");
  });
  it("aggiornamento disponibile quando un altro dispositivo ha sincronizzato un commit più recente", () => {
    const local = book(T1);
    const advanced = { ...structuredClone(local), updatedAt: T3,
      remote: { ...local.remote!, lastSyncedCommit: SHA2, lastSyncAt: T3 } };
    expect(libraryView(lib(entryFor(advanced, DEVICE_B, T3)), [local], DEVICE_A.id)[0]!.kind).toBe("update_available");
  });
  it("non propone aggiornamenti per le proprie scritture né quando il locale è più avanti", () => {
    const local = book(T3);
    expect(libraryView(lib(entryFor(local, DEVICE_A, T3)), [local], DEVICE_A.id)[0]!.kind).toBe("in_sync");
    expect(libraryView(lib(entryFor(book(T1))), [local], DEVICE_A.id)[0]!.kind).toBe("local_ahead");
  });
  it("un libro locale senza collegamento GitHub non è mai «aggiornabile»", () => {
    const view = libraryView(lib(entryFor(book(T3))), [book(T1, false)], DEVICE_A.id);
    expect(view[0]!.kind).toBe("unlinked");
  });
});
