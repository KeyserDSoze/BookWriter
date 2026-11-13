export type Page = "library" | "dashboard" | "activities" | "costs" | "reader" | "atlas" | "settings" | "export" | "bookSettings";

export interface Route { page: Page; book?: string; task?: string; chapter?: string }

// Hash routing: the app is static (GitHub Pages), so a refresh can only restore state from the fragment.
const SEGMENT: Record<Page, string> = {
  library: "libreria", dashboard: "dashboard", activities: "attivita", costs: "costi",
  reader: "libro", atlas: "memoria", settings: "impostazioni", export: "archivio", bookSettings: "modelli",
};
const PAGE_OF = new Map(Object.entries(SEGMENT).map(([page, segment]) => [segment, page as Page]));
const MAX_ID = 120;

const cleanId = (value: string | null): string | undefined =>
  value && value.length <= MAX_ID && /^[\w.:-]+$/.test(value) ? value : undefined;

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const [path = "", query = ""] = raw.split("?");
  const page = PAGE_OF.get(path.replace(/\/+$/, "")) ?? "dashboard";
  const params = new URLSearchParams(query);
  const route: Route = { page };
  const book = cleanId(params.get("book")); if (book) route.book = book;
  const task = cleanId(params.get("task")); if (task) route.task = task;
  const chapter = cleanId(params.get("chapter")); if (chapter) route.chapter = chapter;
  return route;
}

export function formatRoute(route: Route): string {
  const params = new URLSearchParams();
  if (route.book) params.set("book", route.book);
  if (route.task) params.set("task", route.task);
  if (route.chapter) params.set("chapter", route.chapter);
  const query = params.toString();
  return `#/${SEGMENT[route.page]}${query ? "?" + query : ""}`;
}
