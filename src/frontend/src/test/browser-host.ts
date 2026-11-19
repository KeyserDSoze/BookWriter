import { afterAll, beforeAll } from "vitest";

// Every test file runs on the browser host (fake IndexedDB, WebCrypto, stubbed Web Locks).
// It is imported only once the test file has registered its own `vi.mock` calls, so a test can
// still replace `infrastructure/crypto` or `infrastructure/db` and the engine sees the mock.
let uninstall: (() => void) | undefined;
beforeAll(async () => {
  const { installBrowserHost } = await import("../host/browser-host");
  uninstall = installBrowserHost();
});
afterAll(() => { uninstall?.(); uninstall = undefined; });
