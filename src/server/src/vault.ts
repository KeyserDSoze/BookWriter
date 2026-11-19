import * as fs from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { spawn } from "node:child_process";
import type { EncryptedSecret } from "@engine/index";

async function dpapi(value: Buffer, protect: boolean): Promise<Buffer> {
  const method = protect ? "Protect" : "Unprotect";
  const script = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadLine()); $o=[Security.Cryptography.ProtectedData]::${method}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($o))`;
  return new Promise((accept, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    let result = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Vault Windows non disponibile.")); }, 10_000);
    child.stdout.on("data", b => { result += String(b); if (result.length > 4096) child.kill(); });
    child.once("error", () => { clearTimeout(timer); reject(new Error("DPAPI non disponibile.")); });
    child.once("exit", code => { clearTimeout(timer); code === 0 ? accept(Buffer.from(result, "base64")) : reject(new Error("Chiave DPAPI non leggibile per l'identità del servizio.")); });
    child.stdin.end(value.toString("base64") + "\n");
  });
}
export class Vault {
  private constructor(private readonly key: Buffer) {}
  static async open(root: string): Promise<Vault> {
    const directory = join(root, "private");
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const directoryStat = await fs.lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() ||
        process.platform !== "win32" && (directoryStat.mode & 0o077) !== 0)
      throw new Error("Directory del vault non sicura.");
    const file = join(directory, "master.key");
    let key: Buffer;
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
          process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw new Error("Permessi della chiave server non sicuri.");
      const stored = await fs.readFile(file);
      key = process.platform === "win32" ? await dpapi(stored, false) : stored;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      key = randomBytes(32);
      await fs.writeFile(file, process.platform === "win32" ? await dpapi(key, true) : key, { flag: "wx", mode: 0o600, flush: true });
      if (process.platform !== "win32") {
        const handle = await fs.open(directory, "r");
        try { await handle.sync(); } finally { await handle.close(); }
      }
    }
    if (key.length !== 32) throw new Error("Chiave server corrotta: nessuna rigenerazione automatica.");
    return new Vault(key);
  }
  async encrypt(text: string): Promise<EncryptedSecret> {
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from("bookwriter-server-v1"));
    const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final(), cipher.getAuthTag()]);
    return { iv: iv.toString("base64"), data: data.toString("base64") };
  }
  async decrypt(value: EncryptedSecret): Promise<string> {
    try {
      const data = Buffer.from(value.data, "base64");
      const cipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(value.iv, "base64"));
      cipher.setAAD(Buffer.from("bookwriter-server-v1")); cipher.setAuthTag(data.subarray(-16));
      return Buffer.concat([cipher.update(data.subarray(0, -16)), cipher.final()]).toString("utf8");
    } catch { throw new Error("Credenziale server non decifrabile."); }
  }
}
