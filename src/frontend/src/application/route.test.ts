import { describe, expect, it } from "vitest";
import { currentRoute, formatRoute, parseRoute } from "./route";

describe("routing con indirizzi veri", () => {
  it("senza percorso apre la Dashboard", () => {
    expect(parseRoute("")).toEqual({ page: "dashboard" });
    expect(parseRoute("/sconosciuta")).toEqual({ page: "dashboard" });
  });
  it("round-trip di pagina, libro, task e capitolo, senza #", () => {
    const route = { page: "activities" as const, book: "b-1", task: "a_2" };
    expect(formatRoute(route)).toBe("/attivita?book=b-1&task=a_2");
    expect(parseRoute(formatRoute(route))).toEqual(route);
    const reader = { page: "reader" as const, book: "b-1", chapter: "ch-3" };
    expect(parseRoute(formatRoute(reader))).toEqual(reader);
    const settings = { page: "settings" as const, tab: "cloud" };
    expect(formatRoute(settings)).toBe("/impostazioni?tab=cloud");
    expect(parseRoute(formatRoute(settings))).toEqual(settings);
    expect(formatRoute({ page: "atlas", book: "b1" })).toBe("/worldbuilding?book=b1");
  });
  it("i vecchi link con # e il vecchio nome «mondo» funzionano ancora", () => {
    expect(parseRoute("#/costi?book=b-1")).toEqual({ page: "costs", book: "b-1" });
    expect(parseRoute("#/mondo?book=b1")).toEqual({ page: "atlas", book: "b1" });
    expect(parseRoute("/memoria")).toEqual({ page: "atlas" });
    expect(currentRoute({ pathname: "/", search: "", hash: "#/revisioni?book=b2" })).toEqual({ route: { page: "reviews", book: "b2" }, legacy: true });
    expect(currentRoute({ pathname: "/worldbuilding", search: "?book=b2", hash: "" })).toEqual({ route: { page: "atlas", book: "b2" }, legacy: false });
  });
  it("scarta identificatori non validi o troppo lunghi", () => {
    expect(parseRoute("/attivita?book=<script>&task=" + "x".repeat(500))).toEqual({ page: "activities" });
    expect(parseRoute("/libreria?book=../etc")).toEqual({ page: "library" });
    expect(parseRoute("/modelli?tab=<b>")).toEqual({ page: "bookSettings" });
  });
});
