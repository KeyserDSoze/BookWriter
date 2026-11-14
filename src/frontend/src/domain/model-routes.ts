import { TASK_KINDS, routeFor, type AppSettings, type BookProject, type TaskKind } from "./types";

/** A missing global default is harmless when the book/task routes cover every task. */
export function missingModelRoutes(settings: AppSettings, book: BookProject): TaskKind[] {
  return TASK_KINDS.filter(kind => {
    const route = routeFor(kind, settings, book);
    return !route.modelId.trim() || !settings.endpoints.some(endpoint => endpoint.id === route.endpointId);
  });
}
