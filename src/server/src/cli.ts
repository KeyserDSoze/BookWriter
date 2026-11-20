import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import serverPackage from "../package.json";
import {
  RuntimeInstaller, assertExactSemver, assertSupportedNode, defaultDataRoot, PACKAGE_NAME,
  sanitizedNpmEnvironment, superviseServer,
} from "./runtime-install";

const HELP = `Uso:\n  npx ${PACKAGE_NAME} setup [--data-root DIRECTORY] [--no-prompt]\n  npx ${PACKAGE_NAME} start [--data-root DIRECTORY]\n  npx ${PACKAGE_NAME} status\n  npx ${PACKAGE_NAME} doctor\n  npx ${PACKAGE_NAME} update [--data-root DIRECTORY] [--to VERSION]\n`;
interface ParsedCommand { command: string; dataRoot?: string; requestedVersion?: string; noPrompt?: boolean }
function parseCommand(argv: readonly string[]): ParsedCommand {
  const command = argv[0];
  if (!command || command === "--help" || command === "help") return { command: "help" };
  if (!["setup", "start", "status", "doctor", "update"].includes(command)) throw new Error(`Comando non riconosciuto.\n${HELP}`);
  const parsed: ParsedCommand = { command };
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--data-root" && ["setup", "start", "status", "doctor", "update"].includes(command)) {
      const value = argv[++index]; if (!value || value.startsWith("--")) throw new Error("--data-root richiede una directory.");
      parsed.dataRoot = value; continue;
    }
    if (flag === "--no-prompt" && command === "setup") { parsed.noPrompt = true; continue; }
    if (flag === "--to" && command === "update") {
      const value = argv[++index]; if (!value) throw new Error("--to richiede una versione semver esatta.");
      assertExactSemver(value); parsed.requestedVersion = value; continue;
    }
    throw new Error(`Opzione non ammessa per ${command}: ${flag}`);
  }
  return parsed;
}
function commandLine(command: string, args: readonly string[]): { ok: boolean; output: string } {
  const result = spawnSync(command, [...args], { shell: false, windowsHide: true, encoding: "utf8", env: sanitizedNpmEnvironment(), timeout: 15_000 });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim() };
}
function versionAtLeast(value: string, minimum: readonly [number, number]): boolean {
  const match = /(?:^|\s)(\d+)\.(\d+)(?:\.|\b)/.exec(value);
  return !!match && (Number(match[1]) > minimum[0] || Number(match[1]) === minimum[0] && Number(match[2]) >= minimum[1]);
}
export interface DoctorCheck { name: string; ok: boolean; detail: string; required?: boolean }
export function doctorChecks(platform = process.platform,
  probe: (command: string, args: readonly string[]) => { ok: boolean; output: string } = commandLine): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  try { assertSupportedNode(); checks.push({ name: "Node.js", ok: true, required: true, detail: process.versions.node }); }
  catch (error) { checks.push({ name: "Node.js", required: true, ok: false, detail: error instanceof Error ? error.message : "non supportato" }); }
  const npm = probe(process.platform === "win32" ? "npm.cmd" : "npm", ["--version"]);
  checks.push({ name: "npm", required: true, ok: npm.ok, detail: npm.ok ? npm.output : "npm non disponibile" });
  const git = probe("git", ["--version"]);
  checks.push({ name: "Git 2.32+ (solo cartelle di lavoro GitHub; facoltativo per REST)", required: false, ok: git.ok && versionAtLeast(git.output, [2, 32]), detail: git.ok ? git.output : "git non disponibile" });
  if (platform === "linux") {
    const flock = probe("flock", ["--version"]);
    checks.push({ name: "flock", required: true, ok: flock.ok, detail: flock.ok ? flock.output : "flock non disponibile" });
  } else if (platform === "win32") checks.push({ name: "Lock Windows", required: true, ok: true, detail: "PowerShell Global Mutex previsto" });
  else checks.push({ name: "Sistema operativo", required: true, ok: false, detail: "Il server supporta Linux e Windows." });
  return checks;
}
function output(line: string): void { process.stdout.write(`${line}\n`); }
export async function main(argv = process.argv.slice(2), environment: NodeJS.ProcessEnv = process.env): Promise<number> {
  let parsed: ParsedCommand;
  try { parsed = parseCommand(argv); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : "Comando non valido."}\n`); return 2; }
  if (parsed.command === "help") { output(HELP.trimEnd()); return 0; }
  const dataRoot = parsed.dataRoot ? resolve(parsed.dataRoot) : defaultDataRoot(environment);
  const installer = new RuntimeInstaller({ dataRoot });
  try {
    if (parsed.command === "setup") {
      assertSupportedNode();
      const active = await installer.installVersion(serverPackage.version);
      output(`BookWriter Personal Server ${active.version} installato in ${dataRoot}.`);
      output(`Avvia con: npx ${PACKAGE_NAME} start`);
      output("Amministrazione locale: http://127.0.0.1:24105 (la porta non va esposta). API locale: 24106.");
      return 0;
    }
    if (parsed.command === "update") {
      assertSupportedNode();
      const previous = await installer.activeRuntime();
      const active = await installer.installVersion(parsed.requestedVersion ?? "latest");
      output(`BookWriter Personal Server aggiornato da ${previous?.version ?? "nessuna versione"} a ${active.version}. Il processo in esecuzione, se presente, non è stato modificato.`);
      return 0;
    }
    if (parsed.command === "status") {
      const state = await installer.installerState(); const active = await installer.activeRuntime();
      output(`Pacchetto: ${PACKAGE_NAME}`); output(`Directory dati: ${dataRoot}`);
      output(`Versione attiva: ${active?.version ?? state?.activeVersion ?? "non configurata"}`);
      return active || state ? 0 : 1;
    }
    if (parsed.command === "doctor") {
      const checks = doctorChecks();
      for (const check of checks) output(`${check.ok ? "OK" : "ERRORE"} · ${check.name}: ${check.detail}`);
      const state = await installer.installerState(); const active = await installer.activeRuntime();
      output(`${active ? "OK" : "ERRORE"} · Runtime: ${active?.version ?? "non configurato"}`);
      output(`${state ? "OK" : "AVVISO"} · Stato installazione: ${state ? state.activeVersion : "non configurato"}`);
      return checks.every(check => check.ok || check.required === false) && !!active && !!state ? 0 : 1;
    }
    if (parsed.command === "start") {
      const checks = doctorChecks();
      const failed = checks.filter(check => check.required !== false && !check.ok);
      if (failed.length) throw new Error(failed.map(check => `${check.name}: ${check.detail}`).join("; "));
      output(`BookWriter Personal Server · directory dati ${dataRoot}`);
      const exit = await superviseServer({ installer, currentVersion: serverPackage.version, forwardSignals: true });
      if (exit.code !== null) return exit.code;
      return exit.signal ? 1 : 0;
    }
    return 2;
  } catch (error) {
    process.stderr.write(`Operazione non riuscita: ${error instanceof Error ? error.message : "errore non previsto"}.\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}

export * from "./runtime-install";
