import { describe, expect, it } from "vitest";
import { z } from "zod";
import { REVIEW_REPORT_TOOL } from "./editorial-board";
import { describeUnder, hasRequiredFields, normalizeToolArguments, toolParameters, toolRequestFields } from "./structured-output";

type Node = { type?: string; description?: string; required?: string[]; properties?: Record<string, Node>; items?: Node;
  enum?: string[]; const?: string; additionalProperties?: unknown };

describe("Parametri della funzione derivati dallo schema di validazione", () => {
  it("tiene tipi, campi obbligatori, enum e costanti; toglie limiti, pattern e default", () => {
    const schema = toolParameters(z.object({
      mode: z.literal("delta"),
      title: z.string().min(2).max(80).regex(/^\w+/),
      tags: z.array(z.enum(["a", "b"])).min(1).max(9).optional(),
      note: z.string().max(400).default(""),
      notes: z.record(z.string().min(1).max(10), z.string().max(900)),
    }).strict()) as Node;
    expect(schema.required).toEqual(["mode", "title", "notes"]);
    expect(schema.properties!.mode).toEqual({ type: "string", const: "delta" });
    expect(schema.properties!.title).toEqual({ type: "string" });
    expect(schema.properties!.tags).toMatchObject({ type: "array", minItems: 1, items: { enum: ["a", "b"] } });
    expect(schema.properties!.notes).toEqual({ type: "object", additionalProperties: { type: "string" } });
    expect(JSON.stringify(schema)).not.toMatch(/maxLength|minLength|maxItems|pattern|default|\$schema|propertyNames|"additionalProperties":false/);
  });

  it("spiega i campi per percorso, anche dentro le liste e sotto un campo padre", () => {
    const schema = toolParameters(z.object({ decisions: z.array(z.object({ findingId: z.string() })) }), {
      "": "Radice", decisions: "Una per rilievo", "decisions.findingId": "ID esatto" }) as Node;
    expect(schema.description).toBe("Radice");
    expect(schema.properties!.decisions!.description).toBe("Una per rilievo");
    expect(schema.properties!.decisions!.items!.properties!.findingId!.description).toBe("ID esatto");
    expect(describeUnder("knowledge", { entities: "Schede", "entities.name": "Nome" }))
      .toEqual({ "knowledge.entities": "Schede", "knowledge.entities.name": "Nome" });
  });

  it("un oggetto senza campi obbligatori non giustifica una chiamata forzata", () => {
    expect(hasRequiredFields(undefined)).toBe(false);
    expect(hasRequiredFields(toolParameters(z.object({ a: z.string().optional() })))).toBe(false);
    expect(hasRequiredFields(toolParameters(z.object({ a: z.string() })))).toBe(true);
  });

  it("forza l'unica funzione con «required», la forma che anche llama.cpp rispetta", () => {
    const fields = toolRequestFields(toolParameters(z.object({ a: z.string() })));
    expect(fields.tool_choice).toBe("required");
    expect(fields.tools).toHaveLength(1);
  });

  it("toglie solo involucri sicuri dagli argomenti, il resto va alla validazione invariato", () => {
    const schema = toolParameters(z.object({ verdict: z.string(), notes: z.string().optional() }));
    expect(normalizeToolArguments('{"verdict":"freeze"}', schema)).toBe('{"verdict":"freeze"}');
    expect(normalizeToolArguments('{ "verdict" : "freeze" }', schema)).toBe('{ "verdict" : "freeze" }');
    expect(normalizeToolArguments('{"parameters":{"verdict":"repair","notes":"x"}}', schema)).toBe('{"verdict":"repair","notes":"x"}');
    expect(normalizeToolArguments(JSON.stringify('{"verdict":"freeze"}'), schema)).toBe('{"verdict":"freeze"}');
    expect(normalizeToolArguments('{"a":{"verdict":"x"},"b":1}', schema)).toBe('{"a":{"verdict":"x"},"b":1}');
    expect(normalizeToolArguments('{"wrap":{"other":1}}', schema)).toBe('{"wrap":{"other":1}}');
    expect(normalizeToolArguments("non json", schema)).toBe("non json");
    expect(normalizeToolArguments('{"x":1}', { type: "object" })).toBe('{"x":1}');
  });

  it("i revisori hanno tutti la stessa funzione, con i campi del rapporto spiegati", () => {
    const tool = REVIEW_REPORT_TOOL as Node;
    expect(tool.required).toEqual(["verdict", "summary", "findings"]);
    const finding = tool.properties!.findings!.items!;
    expect(finding.required).toEqual(["sceneId", "category", "severity", "evidence", "reason", "remediation"]);
    expect(finding.properties!.evidence!.description).toContain("LETTERALE");
    expect(finding.properties!.historical!.description).toContain("storico");
    expect(tool.properties!.checklist!.description).toContain("regola");
    expect(tool.properties!.memoryNote).toBeDefined();
  });
});
