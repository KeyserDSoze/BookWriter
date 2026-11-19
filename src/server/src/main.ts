import { resolve, join } from "node:path";
import { lockDataRoot } from "./files";
import { startPersonalServer } from "./server";
import { installOutboundNetwork } from "./network";

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--data-root")) {
  process.stderr.write("Uso: node server.mjs [--data-root DIRECTORY]\n"); process.exitCode = 1;
} else {
  const root = resolve(args[1] ?? process.cwd());
  let server: Awaited<ReturnType<typeof startPersonalServer>> | undefined;
  let shuttingDown = false;
  let release: (() => Promise<void>) | undefined;
  let restoreNetwork: (() => void) | undefined;
  const stop = async () => {
    if (shuttingDown) return; shuttingDown = true;
    await server?.close(); restoreNetwork?.(); await release?.();
  };
  try {
    release = await lockDataRoot(root, () => { process.exitCode = 1; void stop(); });
    server = await startPersonalServer({ root });
    restoreNetwork = installOutboundNetwork(server.allowedBases);
    process.stdout.write(`BookWriter: admin http://127.0.0.1:${server.adminPort} · API http://127.0.0.1:${server.apiPort}\nCodice amministratore: ${join(root, "private", "admin-bootstrap.txt")}\n`);
    process.once("SIGINT", () => { void stop(); }); process.once("SIGTERM", () => { void stop(); });
  } catch {
    process.stderr.write("Avvio non riuscito: verifica porte, permessi, lock OS e integrità dei file. Nessun dato eliminato.\n");
    process.exitCode = 1; await stop();
  }
}
