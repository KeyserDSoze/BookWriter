import { z } from "zod";

export const NPM_SERVER_PACKAGE = "bookwriter-personal-server";
const NPM_LATEST = "https://registry.npmjs.org/" + NPM_SERVER_PACKAGE + "/latest";
const MAX_PACKUMENT_BYTES = 256 * 1024;
const versionSchema = z.string().max(100).regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/).refine(value => {
  const pre = value.split("+", 1)[0]!.split("-", 2)[1];
  return !pre || pre.split(".").every(part => !/^\d+$/.test(part) || part === "0" || !part.startsWith("0"));
});
const manifestSchema = z.object({
  name: z.literal(NPM_SERVER_PACKAGE), version: versionSchema,
  repository: z.object({
    url: z.enum(["git+https://github.com/KeyserDSoze/BookWriter.git", "https://github.com/KeyserDSoze/BookWriter.git"]),
    directory: z.literal("src/server"),
  }).passthrough(),
  dist: z.object({
    integrity: z.string().min(20).max(500),
    signatures: z.array(z.object({ keyid: z.string().min(1), sig: z.string().min(20) }).strict()).min(1).optional(),
    attestations: z.object({ url: z.string().url(), provenance: z.object({ predicateType: z.string().min(1) }).strict().optional() }).strict().optional(),
  }).passthrough(),
}).passthrough();

export function trustedNpmReleaseMetadata(value: unknown, expectedVersion?: string,
  allowRegistryBootstrap = false): { version: string } {
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) throw new Error("Metadati npm non validi o provenienza diversa dal repository BookWriter.");
  const latest = parsed.data.version;
  if (expectedVersion && latest !== expectedVersion) throw new Error("Versione npm diversa da quella richiesta.");
  const provenanceType = parsed.data.dist.attestations?.provenance?.predicateType;
  const attested = !!parsed.data.dist.signatures?.length &&
    (provenanceType === "https://slsa.dev/provenance/v1" || provenanceType === "https://slsa.dev/provenance/v0.2") &&
    parsed.data.dist.attestations?.url === `https://registry.npmjs.org/-/npm/v1/attestations/${NPM_SERVER_PACKAGE}@${latest}`;
  if (!attested && !(allowRegistryBootstrap && latest === "0.1.0" && latest === expectedVersion && !!parsed.data.dist.signatures?.length))
    throw new Error("La release npm non ha firma del registry e attestazione di provenienza richieste.");
  return { version: latest };
}

export interface NpmReleaseCheck {
  packageName: typeof NPM_SERVER_PACKAGE;
  installedVersion: string;
  latestVersion?: string;
  available: boolean;
  canRequest: boolean;
  signed: boolean;
  reason?: "not_published" | "no_trusted_release" | "unavailable" | "up_to_date";
  message: string;
}

function compare(a: string, b: string): number {
  const parsed = (value: string) => {
    const core = value.split("+", 1)[0]!;
    const [numbers, prerelease] = core.split("-", 2);
    return { numbers: numbers!.split("."), prerelease: prerelease ?? "" };
  };
  const left = parsed(a), right = parsed(b);
  for (let i = 0; i < 3; i++) {
    const l = left.numbers[i]!, r = right.numbers[i]!;
    if (l !== r) return l.length !== r.length ? l.length - r.length : l < r ? -1 : 1;
  }
  if (!left.prerelease && right.prerelease) return 1;
  if (left.prerelease && !right.prerelease) return -1;
  if (!left.prerelease && !right.prerelease) return 0;
  const l = left.prerelease.split("."), r = right.prerelease.split(".");
  for (let i = 0; i < Math.max(l.length, r.length); i++) {
    if (l[i] === undefined) return -1; if (r[i] === undefined) return 1;
    if (l[i] === r[i]) continue;
    const ln = /^\d+$/.test(l[i]!), rn = /^\d+$/.test(r[i]!);
    if (ln && rn) {
      const left = l[i]!.replace(/^0+/, "") || "0", right = r[i]!.replace(/^0+/, "") || "0";
      return left.length !== right.length ? left.length - right.length : left === right ? 0 : left < right ? -1 : 1;
    }
    if (ln !== rn) return ln ? -1 : 1;
    // SemVer's ASCII lexical order, not locale/case-fold ordering.
    return l[i]! === r[i]! ? 0 : l[i]! < r[i]! ? -1 : 1;
  }
  return 0;
}

async function boundedJson(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_PACKUMENT_BYTES)) throw new Error("Pacchetto npm oltre il limite.");
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength; if (size > MAX_PACKUMENT_BYTES) throw new Error("Pacchetto npm oltre il limite.");
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString("utf8"));
  } finally { try { await reader.cancel(); } catch { /* best effort */ } reader.releaseLock(); }
}

/** Registry metadata is untrusted too. A release is actionable only if the exact version has
 * npm registry signatures AND a provenance attestation from the trusted-publishing workflow. */
export async function checkNpmServerRelease(installedVersion: string,
  fetchImpl: typeof fetch = fetch): Promise<NpmReleaseCheck> {
  if (!versionSchema.safeParse(installedVersion).success) throw new Error("Versione server non valida.");
  const base: NpmReleaseCheck = { packageName: NPM_SERVER_PACKAGE, installedVersion, available: false, canRequest: false,
    signed: false, reason: "unavailable", message: "Versione npm non verificabile: nessun aggiornamento consentito." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetchImpl(NPM_LATEST, { method: "GET", credentials: "omit", redirect: "error", cache: "no-store",
      signal: controller.signal, headers: { Accept: "application/json" }, referrerPolicy: "no-referrer" });
    if (response.status === 404) return { ...base, reason: "not_published", message: "Il pacchetto server non è ancora pubblicato su npm." };
    if (!response.ok) return base;
    let latest: string;
    try { latest = trustedNpmReleaseMetadata(await boundedJson(response)).version; }
    catch { return { ...base, reason: "no_trusted_release",
      message: "La release npm non ha firma del registry, attestazione e repository BookWriter richiesti: nessun aggiornamento consentito." }; }
    if (!latest) return { ...base, latestVersion: latest, reason: "no_trusted_release", message:
      "La versione npm non ha entrambe le firme/attestazioni richieste: aggiornamento rifiutato." };
    const newer = compare(latest, installedVersion) > 0;
    return { packageName: NPM_SERVER_PACKAGE, installedVersion, latestVersion: latest, available: newer, canRequest: newer,
      signed: true, ...(newer ? {} : { reason: "up_to_date" as const }),
      message: newer ? `È disponibile ${latest}, pubblicata con firma npm e attestazione di provenienza.`
        : "Il server usa già la versione npm verificata più recente." };
  } catch {
    return base;
  } finally { clearTimeout(timer); }
}
