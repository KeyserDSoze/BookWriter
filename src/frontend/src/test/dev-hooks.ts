/**
 * Development server only. The browser tests drive the app from inside the page and need the very
 * module instances the app uses (live AI state, fixtures, pure domain functions). The shared engine
 * lives outside this package, so they reach it through this lazy map instead of a hard-coded URL.
 * The production build never loads this file.
 */
const modules = import.meta.glob(["@engine/**/*.ts", "!@engine/**/*.test.ts"]);

export function engineModule(path: string): Promise<any> {
  const wanted = "/engine/src/" + path.replace(/^\/+/, "");
  const key = Object.keys(modules).find(candidate => candidate.endsWith(wanted));
  if (!key) throw new Error("Modulo del motore sconosciuto: " + path);
  return modules[key]!();
}
