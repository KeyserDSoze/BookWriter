import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ActiveRuntime } from "./runtime-install";

export interface AutostartResult {
  kind: "systemd-user"; servicePath: string; activeVersion: string; enabledNow: boolean;
  lingerRequired: boolean; message: string;
}
const serviceName = "bookwriter-personal-server.service";
function quote(value: string): string {
  return '"' + value.replace(/([%\\"])/g, char => char === "%" ? "%%" : "\\" + char) + '"';
}
export function renderUserService(active: ActiveRuntime, dataRoot: string, nodeBinary = process.execPath): string {
  const exec = [quote(resolve(nodeBinary)), quote(resolve(join(active.packageRoot, "dist", "cli.mjs"))),
    "start", "--data-root", quote(resolve(dataRoot))].join(" ");
  return `[Unit]
Description=BookWriter Personal Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${exec}
Restart=on-failure
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=default.target
`;
}
function systemctl(path: string, args: string[], env: NodeJS.ProcessEnv): { ok: boolean; output: string } {
  const result = spawnSync(path, args, { shell: false, windowsHide: true, encoding: "utf8", env,
    timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
  return { ok: result.status === 0, output: String(result.stdout ?? "") + String(result.stderr ?? "") };
}

/** Installs a user-level systemd service for THIS data root. It never writes or changes another service. */
export async function configureAutostart(active: ActiveRuntime, dataRoot: string,
  environment: NodeJS.ProcessEnv = process.env): Promise<AutostartResult> {
  if (process.platform !== "linux")
    throw new Error("L'autostart del CLI è disponibile su Linux systemd. Su Windows il pacchetto non installa ancora un servizio.");
  const uid = process.getuid?.();
  if (uid === 0) throw new Error("Non installare l'autostart come root: esegui il comando come l'utente che deve possedere il server e i dati.");
  const runtimeDir = environment.XDG_RUNTIME_DIR || (uid !== undefined ? `/run/user/${uid}` : "");
  const env = { ...environment, HOME: environment.HOME ?? homedir(), XDG_RUNTIME_DIR: runtimeDir,
    DBUS_SESSION_BUS_ADDRESS: environment.DBUS_SESSION_BUS_ADDRESS ?? (runtimeDir ? `unix:path=${join(runtimeDir, "bus")}` : "") };
  const systemctlPath = environment.BOOKWRITER_SYSTEMCTL || "systemctl";
  const configDir = join(env.HOME!, ".config", "systemd", "user");
  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
  const path = join(configDir, serviceName);
  await fs.writeFile(path, renderUserService(active, dataRoot), { mode: 0o600 });
  const reload = systemctl(systemctlPath, ["--user", "daemon-reload"], env);
  if (!reload.ok) throw new Error("Servizio scritto, ma systemd --user non risponde. Avvia il comando da una sessione utente reale o configura XDG_RUNTIME_DIR.");
  const enable = systemctl(systemctlPath, ["--user", "enable", "--now", serviceName], env);
  if (!enable.ok) throw new Error("Il servizio è stato scritto ma non è stato possibile abilitarlo e avviarlo. Controlla systemctl --user status bookwriter-personal-server.service.");
  const linger = spawnSync("loginctl", ["show-user", process.env.USER ?? String(uid), "-p", "Linger", "--value"],
    { shell: false, encoding: "utf8", env }).stdout?.trim();
  const lingerRequired = linger !== "yes";
  return { kind: "systemd-user", servicePath: path, activeVersion: active.version, enabledNow: true, lingerRequired,
    message: lingerRequired
      ? `Servizio utente avviato. Per partire anche dopo il reboot senza login, l'amministratore deve eseguire: sudo loginctl enable-linger ${process.env.USER ?? String(uid)}`
      : "Servizio utente abilitato e avviato; ripartirà anche dopo il riavvio del PC." };
}

export async function autostartStatus(home = homedir()): Promise<string | undefined> {
  try { await fs.stat(join(home, ".config", "systemd", "user", serviceName)); return join(home, ".config", "systemd", "user", serviceName); }
  catch { return undefined; }
}
