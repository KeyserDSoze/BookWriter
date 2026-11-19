import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { registerServiceWorker, requestPersistentStorage } from "./application/pwa";
import { installBrowserHost } from "./host/browser-host";

// The shared editorial engine runs on IndexedDB, WebCrypto and Web Locks: install them before anything else.
installBrowserHost();
// Development server only: the browser tests reach the engine's modules through this hook.
if (import.meta.env.DEV) {
  (window as unknown as { __engine: (path: string) => Promise<unknown> }).__engine =
    path => import("./test/dev-hooks").then(hooks => hooks.engineModule(path));
}
registerServiceWorker();
requestPersistentStorage();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
