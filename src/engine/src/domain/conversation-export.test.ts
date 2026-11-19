import { describe, expect, it } from "vitest";
import {
  CONVERSATIONS_DIR, CONVERSATIONS_INDEX, conversationPath, isConversationPath, projectConversations,
  type ConversationRecord,
} from "./conversation-export";

const trace = (id: string, extra: Partial<ConversationRecord> = {}): ConversationRecord => ({
  activityId: id, bookId: "book-1", createdAt: "2026-11-14T10:00:00.000Z", endpointId: "openai", modelId: "m",
  systemPrompt: "SYSTEM " + id, userPrompt: "USER " + id, response: "RISPOSTA " + id, truncated: false, ...extra,
});

describe("conversazioni AI nella repository del libro", () => {
  it("un file per conversazione più un indice, nessuna credenziale", () => {
    const result = projectConversations("book-1", [trace("a"), trace("b", { reasoning: "ragionamento" })], 0, 1_000_000);
    expect(Object.keys(result.files).sort()).toEqual([
      CONVERSATIONS_DIR + "a.json", CONVERSATIONS_DIR + "b.json", CONVERSATIONS_INDEX]);
    const file = JSON.parse(result.files[CONVERSATIONS_DIR + "b.json"]!);
    expect(file).toMatchObject({ schemaVersion: 1, kind: "ai-conversation", activityId: "b", reasoning: "ragionamento",
      systemPrompt: "SYSTEM b", userPrompt: "USER b", response: "RISPOSTA b" });
    expect(file).not.toHaveProperty("kept");
    const index = JSON.parse(result.files[CONVERSATIONS_INDEX]!);
    expect(index).toMatchObject({ count: 2, omitted: 0, bookId: "book-1" });
    expect(index.conversations.map((item: { activityId: string }) => item.activityId)).toEqual(["a", "b"]);
    expect(JSON.stringify(result.files)).not.toMatch(/github_pat|sk-|Authorization/);
  });
  it("rispetta il budget senza includere mai una conversazione a metà e dichiara cosa ha lasciato fuori", () => {
    const traces = [trace("nuova"), trace("media"), trace("vecchia")];
    const one = projectConversations("book-1", [traces[0]!], 0, 1_000_000);
    const size = JSON.stringify({ path: CONVERSATIONS_DIR + "nuova.json", mode: "100644", type: "blob",
      content: one.files[CONVERSATIONS_DIR + "nuova.json"] }).length + 1;
    const limited = projectConversations("book-1", traces, 2, size * 2 + 5);
    expect(limited.included).toBe(2);
    expect(limited.omitted).toBe(3); // 1 over the budget + 2 older ones the caller already left out
    expect(Object.keys(limited.files)).not.toContain(CONVERSATIONS_DIR + "vecchia.json");
    expect(JSON.parse(limited.files[CONVERSATIONS_INDEX]!)).toMatchObject({ count: 2, omitted: 3 });
  });
  it("budget zero: nessun file di conversazione, ma l'indice dice quante sono rimaste fuori", () => {
    const result = projectConversations("book-1", [trace("a")], 0, 0);
    expect(Object.keys(result.files)).toEqual([CONVERSATIONS_INDEX]);
    expect(result).toMatchObject({ included: 0, omitted: 1 });
  });
  it("senza conversazioni non scrive nulla", () => {
    expect(projectConversations("book-1", [], 0, 1_000_000)).toEqual({ files: {}, included: 0, omitted: 0 });
  });
  it("scarta conversazioni di un altro libro e ID che non sono nomi di file sicuri", () => {
    const result = projectConversations("book-1", [
      trace("../evil"), trace("con/slash"), trace("altro", { bookId: "book-2" }), trace("ok")], 0, 1_000_000);
    expect(Object.keys(result.files).sort()).toEqual([CONVERSATIONS_INDEX, CONVERSATIONS_DIR + "ok.json"]);
    expect(result.omitted).toBe(3);
  });
  it("riconosce solo i propri percorsi come cancellabili", () => {
    expect(conversationPath("abc-123_X")).toBe(CONVERSATIONS_DIR + "abc-123_X.json");
    expect(conversationPath("a b")).toBeNull();
    expect(isConversationPath(CONVERSATIONS_DIR + "abc.json")).toBe(true);
    expect(isConversationPath(CONVERSATIONS_INDEX)).toBe(true);
    for (const path of [".bookwriter/project.json", ".bookwriter/conversations/../project.json", "book.md",
      ".bookwriter/conversations/x.md", "/.bookwriter/conversations/x.json", ".bookwriter/conversations/a b.json"])
      expect(isConversationPath(path)).toBe(false);
  });
});
