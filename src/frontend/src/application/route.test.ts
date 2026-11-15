import { describe, expect, it } from "vitest";
import { formatRoute, parseRoute } from "./route";

describe("routing a frammento", () => {
  it("senza frammento apre la Dashboard", () => {
    expect(parseRoute("")).toEqual({ page: "dashboard" });
    expect(parseRoute("#/sconosciuta")).toEqual({ page: "dashboard" });
  });
  it("round-trip di pagina, libro, task e capitolo", () => {
    const route = { page: "activities" as const, book: "b-1", task: "a_2" };
    expect(formatRoute(route)).toBe("#/attivita?book=b-1&task=a_2");
    expect(parseRoute(formatRoute(route))).toEqual(route);
    const reader = { page: "reader" as const, book: "b-1", chapter: "ch-3" };
    expect(parseRoute(formatRoute(reader))).toEqual(reader);
    const settings = { page: "settings" as const, tab: "cloud" };
    expect(formatRoute(settings)).toBe("#/impostazioni?tab=cloud");
    expect(parseRoute(formatRoute(settings))).toEqual(settings);
  });
  it("scarta identificatori non validi o troppo lunghi", () => {
    expect(parseRoute("#/attivita?book=<script>&task=" + "x".repeat(500))).toEqual({ page: "activities" });
    expect(parseRoute("#/libreria?book=../etc")).toEqual({ page: "library" });
    expect(parseRoute("#/modelli?tab=<b>")).toEqual({ page: "bookSettings" });
  });
});
