import { useMemo, useState } from "react";
import { Button } from "../ui/button";

type Language = "it" | "en" | "es";
type Platform = "windows" | "linux";
type Text = {
  title: string; intro: string; warning: string; language: string; platform: string;
  prerequisites: string; source: string; guide: string; copy: string; copied: string; download: string;
  opensAdmin: string; firstStart: string; next: string; npm: string; sourceZip: string; node: string; git: string; cloudflare: string;
  scriptName: string; rootHint: string; workingFolder: string; folders: string; cloudflareSteps: string;
};

const COPY: Record<Language, Text> = {
  it: {
    title: "Installa il server con npm",
    intro: "Il server si installa dal pacchetto npm pubblico e lo aggiorna con firme/attestazioni del registro. Non serve clonare il repository né compilare: `npx` prepara l’area dati, verifica le firme npm e avvia il server. Gli installer di sistema restano sperimentali.",
    warning: "Sicurezza: leggi lo script prima di eseguirlo. Lo script prepara soltanto il pacchetto npm; i comandi `npm install` eseguiti da npx scaricano artefatti firmati dal registro. Nessun comando viene eseguito dal browser.",
    language: "Lingua guida", platform: "Sistema operativo", prerequisites: "1. Installa i prerequisiti",
    source: "2. Esegui npx e avvia il server", guide: "Guida completa", copy: "Copia i comandi", copied: "Comandi copiati.",
    download: "Scarica lo script di preparazione", opensAdmin: "Poi apri http://127.0.0.1:24105",
    firstStart: "Primo avvio: leggi il codice in private/admin-bootstrap.txt nella cartella dati scelta e usalo nel pannello amministrativo.",
    next: "Se la pagina npm mostra 404, la prima release non è ancora stata pubblicata: usa il pulsante ZIP solo come fallback. Il server non pubblica libri né effettua chiamate AI finché non colleghi un token e avvii esplicitamente un libro. Il pannello admin è solo loopback; non esporlo con un tunnel.",
    npm: "Pacchetto npm ufficiale", cloudflare: "Guida tunnel Cloudflare", sourceZip: "Scarica il sorgente ZIP (fallback)", node: "Scarica Node.js 22.14 o successivo", git: "Scarica Git 2.32 o successivo",
    scriptName: "assistente-bookwriter-server",
    rootHint: "Scegli --data-root prima: qui BookWriter conserva libri, vault, token, log e runtime npm. Non deve essere una cartella GitHub Drive/Dropbox, né una directory con permessi condivisi. Conservane il percorso: lo stesso comando start usa sempre lo stesso --data-root.",
    workingFolder: "Dove eseguire il comando",
    folders: "Prima crea o scegli una cartella privata per dati (quella usata da --data-root). Puoi lanciare npx da qualunque directory: il pacchetto resta nella cache npm, ma il programma e i dati sono in --data-root. Non cambia i file del libro solo perché hai eseguito il comando in un'altra cartella.",
    cloudflareSteps: "Cloudflare: se hai già tunnel, hostname e route verso http://127.0.0.1:24106, sei pronto: apri 24105, verifica il token BookWriter e non avviare o modificare altri cloudflared. Se non hai ancora il tunnel, crealo nella console Cloudflare con route/DNS, installa cloudflared ≥2025.4.0 sul PC server, poi inserisci in 24105 solo il token nel pannello Cloudflare. Il token non va mai nel client o nella shell. BookWriter avvia un connettore dedicato e non tocca i tunnel altrui.",
  },
  en: {
    title: "Install the server with npm",
    intro: "The server installs from the public npm package and verifies npm signatures and installs without scripts. No repository clone or build is required: `npx` prepares the data directory, verifies registry attestations and starts the server. OS installers are still experimental.",
    warning: "Security: inspect the script before running it. The script only prepares the npm package; npx downloads registry-signed artifacts. The browser never runs these commands.",
    language: "Guide language", platform: "Operating system", prerequisites: "1. Install prerequisites",
    source: "2. Run npx and start the server", guide: "Full guide", copy: "Copy commands", copied: "Commands copied.",
    download: "Download preparation script", opensAdmin: "Then open http://127.0.0.1:24105",
    firstStart: "First start: read private/admin-bootstrap.txt in the data directory you selected and enter that code in the admin panel.",
    next: "If npm shows 404, the first release is not published yet: use the ZIP fallback. The server does not publish books or call AI until you connect a token and explicitly start a book. The admin panel is loopback-only; never expose it through a tunnel.",
    npm: "Official npm package", cloudflare: "Cloudflare tunnel guide", sourceZip: "Download source ZIP (fallback)", node: "Download Node.js 22.14 or later", git: "Download Git 2.32 or later",
    scriptName: "bookwriter-server-setup",
    rootHint: "Choose --data-root first: it holds books, vault, tokens, logs and npm runtimes. Do not put it in Drive/Dropbox or a shared-permission folder. Reuse exactly the same --data-root for every start.",
    workingFolder: "Where to run the command",
    folders: "Create or choose the private data folder first. npx may run from any terminal directory: the package lives in npm's cache, while BookWriter stores program runtimes and data under --data-root. Running npx somewhere else does not move existing books.",
    cloudflareSteps: "Cloudflare: if a tunnel, hostname and route to http://127.0.0.1:24106 already exist, you are ready: open 24105 and do not start or change other cloudflared connectors. Otherwise create the tunnel and DNS/route in Cloudflare, install cloudflared ≥2025.4.0, then enter only the token in the 24105 Cloudflare panel. Never place it in the client or shell. BookWriter starts a dedicated connector without touching other tunnels.",
  },
  es: {
    title: "Instala el servidor con npm",
    intro: "El servidor se instala desde el paquete público de npm y solo actualiza versiones firmadas/atestadas por el registro. No hace falta clonar ni compilar: `npx` prepara los datos, verifica las firmas npm y arranca el servidor. Los instaladores del sistema siguen siendo experimentales.",
    warning: "Seguridad: revisa el script antes de ejecutarlo. El script solo prepara el paquete npm; npx descarga artefactos firmados por el registro. El navegador nunca ejecuta estos comandos.",
    language: "Idioma de la guía", platform: "Sistema operativo", prerequisites: "1. Instala los requisitos",
    source: "2. Ejecuta npx y arranca el servidor", guide: "Guía completa", copy: "Copiar comandos", copied: "Comandos copiados.",
    download: "Descargar script de preparación", opensAdmin: "Después abre http://127.0.0.1:24105",
    firstStart: "Primer inicio: lee private/admin-bootstrap.txt en la carpeta de datos elegida e introduce el código en el panel de administración.",
    next: "Si npm muestra 404, la primera versión aún no está publicada: usa el ZIP como alternativa. El servidor no publica libros ni llama a la IA hasta que conectes un token y arranques un libro explícitamente. El panel de administración es solo local; no lo expongas mediante un túnel.",
    npm: "Paquete npm oficial", cloudflare: "Guía de túnel Cloudflare", sourceZip: "Descargar ZIP del código (alternativa)", node: "Descargar Node.js 22.14 o posterior", git: "Descargar Git 2.32 o posterior",
    scriptName: "preparar-servidor-bookwriter",
    rootHint: "Elige --data-root antes: contiene libros, vault, tokens, registros y runtimes npm. No lo pongas en Drive/Dropbox ni en una carpeta de permisos compartidos. Usa exactamente el mismo --data-root en cada arranque.",
    workingFolder: "Dónde ejecutar el comando",
    folders: "Crea o elige primero la carpeta privada de datos. Puedes ejecutar npx desde cualquier directorio: el paquete queda en la caché de npm y BookWriter guarda datos/runtime en --data-root. Ejecutar desde otra carpeta no mueve los libros existentes.",
    cloudflareSteps: "Cloudflare: si ya existen el túnel, hostname y route hacia http://127.0.0.1:24106, está listo: abre 24105 y no inicies ni modifiques otros cloudflared. Si no existe, crea túnel y DNS/route en Cloudflare, instala cloudflared ≥2025.4.0 y escribe solo el token en el panel Cloudflare de 24105. No lo pongas en el cliente o la shell. BookWriter inicia un conector dedicado sin tocar túneles ajenos.",
  },
};

const links = {
  npm: "https://www.npmjs.com/package/bookwriter-personal-server",
  source: "https://github.com/KeyserDSoze/BookWriter/archive/refs/heads/main.zip",
  repository: "https://github.com/KeyserDSoze/BookWriter",
  guide: "https://github.com/KeyserDSoze/BookWriter/blob/main/docs/personal-server-development.md",
  node: "https://nodejs.org/en/download",
  git: "https://git-scm.com/downloads",
  cloudflare: "https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/",
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
function shellCommands(platform: Platform, language: Language): string {
  const update = language === "it" ? "# Quando è disponibile un aggiornamento:" : language === "es" ? "# Cuando haya una actualización:" : "# When an update is available:";
  const data = platform === "windows" ? "$HOME\\BookWriter-server-data" : "$HOME/BookWriter-server-data";
  const folder = platform === "windows" ? "$HOME\\BookWriter-server" : "$HOME/BookWriter-server";
  const prepare = platform === "windows" ? `New-Item -ItemType Directory -Force "${folder}" | Out-Null\nSet-Location "${folder}"` : `mkdir -p "${folder}"\ncd "${folder}"`;
  return `${prepare}
npx --yes bookwriter-personal-server setup --data-root "${data}"
npx --yes bookwriter-personal-server doctor --data-root "${data}"
npx --yes bookwriter-personal-server start --data-root "${data}"
${update}
npx --yes bookwriter-personal-server update --data-root "${data}"`;
}
function script(platform: Platform): string {
  const header = platform === "windows"
    ? `# BookWriter server npm setup (inspect before running)\n$ErrorActionPreference = "Stop"\n`
    : `#!/usr/bin/env bash\nset -eu\n`;
  const data = platform === "windows" ? "$HOME\\BookWriter-server-data" : "$HOME/BookWriter-server-data";
  const folder = platform === "windows" ? "$HOME\\BookWriter-server" : "$HOME/BookWriter-server";
  const prepare = platform === "windows"
    ? `New-Item -ItemType Directory -Force "${folder}" | Out-Null\nSet-Location "${folder}"\n`
    : `mkdir -p "${folder}"\ncd "${folder}"\n`;
  const version = `\nnode --version\nGit 2.32+ and, on Linux, flock are checked by \`npx ... doctor\`.\n`;
  void version;
  return header + prepare + `npx --yes bookwriter-personal-server setup --data-root "${data}"\nnpx --yes bookwriter-personal-server doctor --data-root "${data}"\nnpx --yes bookwriter-personal-server start --data-root "${data}"\n# When an update is available:\n# npx --yes bookwriter-personal-server update --data-root "${data}"\n`;
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
  const commands = useMemo(() => shellCommands(platform, language), [platform, language]);
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
      <a className="underline underline-offset-2" href={links.cloudflare} target="_blank" rel="noreferrer">{copy.cloudflare}</a>
      <a className="underline underline-offset-2" href={links.npm} target="_blank" rel="noreferrer">{copy.npm}</a>
      <a className="underline underline-offset-2" href={links.source} rel="noreferrer">{copy.sourceZip}</a>
      <a className="underline underline-offset-2" href={links.guide} target="_blank" rel="noreferrer">{copy.guide}</a>
      <a className="underline underline-offset-2" href={links.repository} target="_blank" rel="noreferrer">GitHub</a>
    </div>
    <h3 className="font-semibold">{copy.prerequisites}</h3>
    <h3 className="font-semibold">{copy.source}</h3>
    <p className="muted text-sm"><strong>{copy.workingFolder}:</strong> {copy.folders}</p>
    <pre className="max-w-full overflow-x-auto rounded border border-slate-300 bg-slate-950 p-3 text-xs text-slate-100 dark:border-slate-700"><code>{commands}</code></pre>
    <div className="flex flex-wrap gap-2">
      <Button type="button" onClick={() => void navigator.clipboard.writeText(commands).then(() => setNotice(copy.copied), () => setNotice(commands))}>{copy.copy}</Button>
      <Button type="button" variant="outline" onClick={() => { download(`${copy.scriptName}.${suffix}`, script(platform)); setNotice(copy.download + "."); }}>{copy.download}</Button>
    </div>
    <section className="rounded border border-slate-300 p-3 text-sm dark:border-slate-700" aria-label="Cloudflare">
      <strong>Cloudflare</strong><p className="mt-1">{copy.cloudflareSteps}</p>
      <a className="underline underline-offset-2" href={links.cloudflare} target="_blank" rel="noreferrer">{copy.cloudflare}</a>
    </section>
    <p className="text-sm"><strong>{copy.opensAdmin}</strong></p>
    <p className="muted text-sm">{copy.firstStart}</p>
    <p className="muted text-sm">{copy.rootHint}</p>
    <p className="muted text-sm">{copy.next}</p>
    {notice && <p role="status" className="break-words text-sm">{notice}</p>}
  </section>;
}
