import { useMemo, useState } from "react";
import { Button } from "../ui/button";

type Language = "it" | "en" | "es";
type Platform = "windows" | "linux";
type Text = {
  title: string; intro: string; warning: string; language: string; platform: string;
  prerequisites: string; source: string; guide: string; copy: string; copied: string; download: string;
  opensAdmin: string; firstStart: string; next: string; sourceZip: string; node: string; git: string;
  scriptName: string; rootHint: string;
};

const COPY: Record<Language, Text> = {
  it: {
    title: "Scarica il sorgente e prepara il server",
    intro: "Questo pannello rende disponibili subito i comandi, le dipendenze e i link ufficiali. Il server parte da sorgente: non è ancora un installer firmato e non si aggiorna da solo.",
    warning: "Sicurezza: leggi lo script prima di eseguirlo. Il download del repository contiene codice non compilato; npm usa il lockfile esistente. Nessun comando viene eseguito dal browser.",
    language: "Lingua guida", platform: "Sistema operativo", prerequisites: "1. Installa i prerequisiti",
    source: "2. Apri il progetto sorgente", guide: "Guida completa", copy: "Copia i comandi", copied: "Comandi copiati.",
    download: "Scarica lo script di preparazione", opensAdmin: "Poi apri http://127.0.0.1:24105",
    firstStart: "Primo avvio: leggi il codice in private/admin-bootstrap.txt nella cartella dati scelta e usalo nel pannello amministrativo.",
    next: "Il server non pubblica libri né effettua chiamate AI finché non colleghi un token e avvii esplicitamente un libro. Il pannello admin è solo loopback; non esporlo con un tunnel.",
    sourceZip: "Scarica il sorgente ZIP", node: "Scarica Node.js 22 o successivo", git: "Scarica Git 2.32 o successivo",
    scriptName: "assistente-bookwriter-server", rootHint: "La cartella dati predefinita mostrata nel comando deve restare privata e fuori da cartelle sincronizzate.",
  },
  en: {
    title: "Download the source and prepare the server",
    intro: "This panel provides the commands, prerequisites and official links immediately. The server currently runs from source: this is not a signed installer and it cannot update itself yet.",
    warning: "Security: inspect the script before running it. The repository archive contains uncompiled source; npm uses the checked-in lockfile. The browser never runs these commands.",
    language: "Guide language", platform: "Operating system", prerequisites: "1. Install prerequisites",
    source: "2. Open the source project", guide: "Full guide", copy: "Copy commands", copied: "Commands copied.",
    download: "Download preparation script", opensAdmin: "Then open http://127.0.0.1:24105",
    firstStart: "First start: read private/admin-bootstrap.txt in the data directory you selected and enter that code in the admin panel.",
    next: "The server does not publish books or call AI until you connect a token and explicitly start a book. The admin panel is loopback-only; never expose it through a tunnel.",
    sourceZip: "Download source ZIP", node: "Download Node.js 22 or later", git: "Download Git 2.32 or later",
    scriptName: "bookwriter-server-setup", rootHint: "Keep the data directory shown in the command private and outside synchronized folders.",
  },
  es: {
    title: "Descarga el código y prepara el servidor",
    intro: "Este panel muestra inmediatamente los comandos, requisitos y enlaces oficiales. El servidor se ejecuta desde el código: aún no es un instalador firmado ni puede actualizarse solo.",
    warning: "Seguridad: revisa el script antes de ejecutarlo. El archivo contiene código sin compilar; npm usa el lockfile incluido. El navegador nunca ejecuta estos comandos.",
    language: "Idioma de la guía", platform: "Sistema operativo", prerequisites: "1. Instala los requisitos",
    source: "2. Abre el proyecto fuente", guide: "Guía completa", copy: "Copiar comandos", copied: "Comandos copiados.",
    download: "Descargar script de preparación", opensAdmin: "Después abre http://127.0.0.1:24105",
    firstStart: "Primer inicio: lee private/admin-bootstrap.txt en la carpeta de datos elegida e introduce el código en el panel de administración.",
    next: "El servidor no publica libros ni llama a la IA hasta que conectes un token y arranques un libro explícitamente. El panel de administración es solo local; no lo expongas mediante un túnel.",
    sourceZip: "Descargar ZIP del código", node: "Descargar Node.js 22 o posterior", git: "Descargar Git 2.32 o posterior",
    scriptName: "preparar-servidor-bookwriter", rootHint: "La carpeta de datos mostrada debe ser privada y no estar dentro de carpetas sincronizadas.",
  },
};

const links = {
  source: "https://github.com/KeyserDSoze/BookWriter/archive/refs/heads/main.zip",
  repository: "https://github.com/KeyserDSoze/BookWriter",
  guide: "https://github.com/KeyserDSoze/BookWriter/blob/main/docs/personal-server-development.md",
  node: "https://nodejs.org/en/download",
  git: "https://git-scm.com/downloads",
};

function preferredLanguage(): Language {
  if (typeof navigator === "undefined") return "en";
  const language = navigator.language.toLowerCase();
  return language.startsWith("it") ? "it" : language.startsWith("es") ? "es" : "en";
}
function preferredPlatform(): Platform {
  if (typeof navigator !== "undefined" && /win/i.test(navigator.platform)) return "windows";
  return "linux";
}
function shellCommands(platform: Platform): string {
  return platform === "windows" ? `git clone https://github.com/KeyserDSoze/BookWriter.git $HOME\\BookWriter
Set-Location $HOME\\BookWriter
Set-Location src\\frontend
npm ci --no-audit --no-fund
Set-Location ..\\server
npm run typecheck
npm run build
node dist/server.mjs --data-root "$HOME\\BookWriter-server-data"` : `git clone https://github.com/KeyserDSoze/BookWriter.git "$HOME/BookWriter"
cd "$HOME/BookWriter/src/frontend"
npm ci --no-audit --no-fund
cd ../server
npm run typecheck
npm run build
node dist/server.mjs --data-root "$HOME/BookWriter-server-data"`;
}
function script(platform: Platform): string {
  return platform === "windows" ? `# BookWriter server source setup (inspect before running)\n` +
`param([string]$Target = "$HOME\\BookWriter")\n$ErrorActionPreference = "Stop"\n` +
`if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git 2.32+ is required." }\n` +
`$gitParts = ((git --version) -replace 'git version ', '').Split('.')
$gitMajor = [int]$gitParts[0]; $gitMinor = [int]$gitParts[1]
if ($gitMajor -lt 2 -or ($gitMajor -eq 2 -and $gitMinor -lt 32)) { throw "Git 2.32+ is required." }\n` +
`if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 22+ is required." }\n` +
`$nodeMajor = [int]((node -p "process.versions.node.split('.')[0]") 2>$null)\nif ($nodeMajor -lt 22) { throw "Node.js 22+ is required." }\n` +
`if (Test-Path $Target) { throw "Target already exists: $Target. Choose another folder." }\n` +
`git clone ${links.repository}.git $Target\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n` +
`Push-Location "$Target\\src\\frontend"\nnpm ci --no-audit --no-fund\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n` +
`Pop-Location\nPush-Location "$Target\\src\\server"\nnpm run typecheck\nnpm run build\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n` +
`Pop-Location\nWrite-Host "Ready. Start with: node dist/server.mjs --data-root '$HOME\\BookWriter-server-data'"\nWrite-Host "Run the start command from: $Target\\src\\server"` :
`#!/usr/bin/env bash\nset -eu\nTARGET="\${1:-$HOME/BookWriter}"\ncommand -v git >/dev/null || { echo "Git 2.32+ is required" >&2; exit 1; }\nGIT_VERSION="$(git --version | awk '{print $3}')"\nGIT_MAJOR="$(printf '%s' "$GIT_VERSION" | cut -d. -f1)"\nGIT_MINOR="$(printf '%s' "$GIT_VERSION" | cut -d. -f2)"\n[ "$GIT_MAJOR" -gt 2 ] || { [ "$GIT_MAJOR" -eq 2 ] && [ "$GIT_MINOR" -ge 32 ]; } || { echo "Git 2.32+ is required" >&2; exit 1; }\ncommand -v flock >/dev/null || { echo "flock (util-linux) is required on Linux" >&2; exit 1; }\ncommand -v node >/dev/null || { echo "Node.js 22+ is required" >&2; exit 1; }\nNODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"\n[ "$NODE_MAJOR" -ge 22 ] || { echo "Node.js 22+ is required" >&2; exit 1; }\n[ ! -e "$TARGET" ] || { echo "Target already exists: $TARGET" >&2; exit 1; }\ngit clone ${links.repository}.git "$TARGET"\ncd "$TARGET/src/frontend"\nnpm ci --no-audit --no-fund\ncd ../server\nnpm run typecheck\nnpm run build\necho "Ready. Start with: node dist/server.mjs --data-root \\$HOME/BookWriter-server-data"\necho "Run that command from: $TARGET/src/server"\n`;
}
function download(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = fileName; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PersonalServerSetupGuide() {
  const [language, setLanguage] = useState<Language>(preferredLanguage);
  const [platform, setPlatform] = useState<Platform>(preferredPlatform);
  const [notice, setNotice] = useState("");
  const copy = COPY[language];
  const commands = useMemo(() => shellCommands(platform), [platform]);
  const suffix = platform === "windows" ? "ps1" : "sh";
  return <section className="panel space-y-3 p-4" aria-label="Guida installazione server personale">
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold">{copy.title}</h2>
        <p className="mt-1 text-sm">{copy.intro}</p>
      </div>
      <label className="min-w-36">{copy.language}
        <select className="field" value={language} onChange={event => { setLanguage(event.target.value as Language); setNotice(""); }}>
          <option value="it">Italiano</option><option value="en">English</option><option value="es">Español</option>
        </select>
      </label>
      <label className="min-w-36">{copy.platform}
        <select className="field" value={platform} onChange={event => { setPlatform(event.target.value as Platform); setNotice(""); }}>
          <option value="windows">Windows (PowerShell)</option><option value="linux">Linux (Bash)</option>
        </select>
      </label>
    </div>
    <p className="rounded border border-amber-500/60 bg-amber-500/10 p-3 text-sm">{copy.warning}</p>
    <div className="flex flex-wrap gap-3 text-sm">
      <a className="underline underline-offset-2" href={links.node} target="_blank" rel="noreferrer">{copy.node}</a>
      <a className="underline underline-offset-2" href={links.git} target="_blank" rel="noreferrer">{copy.git}</a>
      <a className="underline underline-offset-2" href={links.source} rel="noreferrer">{copy.sourceZip}</a>
      <a className="underline underline-offset-2" href={links.guide} target="_blank" rel="noreferrer">{copy.guide}</a>
      <a className="underline underline-offset-2" href={links.repository} target="_blank" rel="noreferrer">GitHub</a>
    </div>
    <h3 className="font-semibold">{copy.prerequisites}</h3>
    <h3 className="font-semibold">{copy.source}</h3>
    <pre className="max-w-full overflow-x-auto rounded border border-slate-300 bg-slate-950 p-3 text-xs text-slate-100 dark:border-slate-700"><code>{commands}</code></pre>
    <div className="flex flex-wrap gap-2">
      <Button type="button" onClick={() => void navigator.clipboard.writeText(commands).then(() => setNotice(copy.copied), () => setNotice(commands))}>{copy.copy}</Button>
      <Button type="button" variant="outline" onClick={() => { download(`${copy.scriptName}.${suffix}`, script(platform)); setNotice(copy.download + "."); }}>{copy.download}</Button>
    </div>
    <p className="text-sm"><strong>{copy.opensAdmin}</strong></p>
    <p className="muted text-sm">{copy.firstStart}</p>
    <p className="muted text-sm">{copy.rootHint}</p>
    <p className="muted text-sm">{copy.next}</p>
    {notice && <p role="status" className="break-words text-sm">{notice}</p>}
  </section>;
}
