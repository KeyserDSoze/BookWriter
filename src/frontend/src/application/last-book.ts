const KEY = "bookwriter:last-book";

/** Id of the book the author worked on last (a non-sensitive pointer, kept only in this browser). */
export function readLastBookId(): string {
  try { return window.localStorage.getItem(KEY) ?? ""; } catch { return ""; }
}
export function rememberLastBookId(id: string): void {
  try { if (id) window.localStorage.setItem(KEY, id); } catch { /* storage unavailable: just don't remember */ }
}
